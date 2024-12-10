/***
 * open source auto documentation tool for REACT codebases
 * generates documentation for all components in a codebase
 * uses storybooks and inline comments, proptypes to document the whole codebase
 */
import dotEnv from "dotenv";
import path from "path";
import os from 'os';

dotEnv.config({
  path: path.join(os.homedir(), '.daluri.env'),
});

import { Octokit } from "@octokit/rest";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import fs from "fs-extra";
import crypto from "crypto";
import simpleGit from "simple-git";
import OpenAIApi from "openai";
import tmpFiles from "tmp-promise";
import MarkdownIt from 'markdown-it';
import t from '@babel/types';
import generateAST from '@babel/generator';
import * as prettier from "prettier";
import consola from 'consola';

const generate = generateAST.default;

class ReactAutoDocumenter {
    /**
     * 
     * @param {string} repo_name 
     * @param {string} branch_name 
     * @param {string} owner 
     * @param {string} local_path
     *  @param {number} file_limits 
     * @param {string} build_tool 
     * @param {string} mode
     */
    constructor(repo_name, branch_name, owner, local_path, file_limits = 5, build_tool = "webpack", mode = "local") { 
        this.build_tool = build_tool;
        this.repo_name = repo_name;
        this.branch_name = branch_name;
        this.owner = owner;
        this.file_limits = file_limits;
        this.mode = mode;
        this.local_path = local_path;

        // initialization of base libraries
        this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
        this.openai = new OpenAIApi(process.env.OPENAI_API_KEY);
        this.documentation_branch_name = `daluri-documentation-${(new Date()).toISOString().replace(/[^0-9]/g, '')}`;
    }

    /**
     * 
     * @param {string} str 
     * @param {string} search_value 
     * @param {string} replace_value 
     * @returns {string}
     */
    #replace_last_occurrence(str, search_value, replace_value) {
        const last_index = str.lastIndexOf(search_value);
        
        if (last_index === -1) {
          return str;
        }

        return str.substring(0, last_index) + replace_value + str.substring(last_index + search_value.length);
    }

    /**
     * 
     * @param {string} source 
     * @returns {string}
     */
    #generate_hash(source) {
        return crypto.createHash("sha256").update(source).digest("hex");
    }

    /**
     * 
     * @param {string} source 
     * @returns 
     */
    #remove_default_exports(source) {
        const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
      
        traverse.default(ast, {
          ExportDefaultDeclaration(path) {
            path.remove();
          }
        });
    
        return generate(ast, {}, source).code;
    }

    /**
     * 
     * @param {string} prompt 
     * @param {boolean} return_raw_response
     * @returns {string}
     */
    async #ai_execute_prompt(prompt, return_raw_response = false) {
        const response = await this.openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
              {
                role: "user",
                content: prompt,
              },
            ],
        });

        const extracted_response = response?.choices[0]?.message?.content?.trim();

        if (return_raw_response) {
            return extracted_response;
        }
    
        const md = new MarkdownIt();
    
        const tokens = md.parse(extracted_response, {});
        const codeBlocks = tokens
            .filter(token => token.type === 'fence' && token.info.trim() === 'javascript')
            .map(token => token.content);

        return codeBlocks.join('\n');
    }

    /**
     * 
     * @param {string} source 
     * @returns 
     */
    async #generate_proptypes(source){
        const prompt = `Generate prop types for this component in the following format 
    
    CustomTooltip.propTypes = {
      /**
       * The content displayed within the tooltip.
       * 
       * @type {string | node}
       * @required
       */
      title: PropTypes.oneOfType([PropTypes.string, PropTypes.node]).isRequired,
    
      /**
       * The element(s) that trigger the tooltip on hover or focus.
       * 
       * @type {node}
       * @required
       */
      children: PropTypes.node.isRequired,
    
      /**
       * Additional styles to customize the appearance of the tooltip.
       * 
       * @type {object}
       */
      styles: PropTypes.object,
    };
    
    CustomTooltip.defaultProps = {
      styles: {},
    };
    
        Here's the component code:
        ${source}`;
    
        const props_code = await this.#ai_execute_prompt(prompt);
    
        return this.#remove_default_exports(props_code);
    };

    /**
     *
     * @param {string} source 
     * @returns 
     */
    async #generate_jsdocs(source) {
        const prompt = `Generate documentation for this component in the following format:
    
    
      /**
       * A customizable Tooltip component built on top of MUI's Tooltip.
       *
       * This component allows you to display additional information or hints when users hover over or focus on an element. 
       * You can provide a custom \`title\` and override default styles via the \`styles\` prop.
       *
       * ### Example Usage
       * \`\`\`jsx
       * <CustomTooltip title="This is a tooltip" styles={{ backgroundColor: "#f0f0f0" }}>
       *   <button>Hover me</button>
       * </CustomTooltip>
       * \`\`\`
       *
       * ### Props
       * - \`title\`: The content to display within the tooltip.
       * - \`children\`: The element(s) that trigger the tooltip on hover or focus.
       * - \`styles\`: An object containing additional styles to override the default tooltip styles.
       * - \`...rest\`: Any additional props accepted by MUI's Tooltip component.
       *
       * @visibleName IR Tooltip
       */
    
      return the comment as a jsdoc comment
    
        Here's the component code:
        ${source}`;
        
        return this.#ai_execute_prompt(prompt);
    };

    /**
     * 
     * @param {string} componentName 
     * @param {string} source 
     * @param {string} full_source_code
     * @param {string} storybookDir 
     * @param {string} componentFileLocation
     * @param {string} componentPath
     * @param {boolean} isDefualtExported
     */
    async #generate_storybook_file (componentName, source, full_source_code, storybookDir, componentFileLocation, componentPath, isDefualtExported = true) {
        consola.info(`Generating Storybook file for ${componentName}...`);
        const conjoined_path = path.join(storybookDir, componentName);
    
        const prompt = `Analyze the following React component code and write a Storybook file for it. Add tags as ['autodocs'], title should be ${conjoined_path.substring(conjoined_path.indexOf("src")).replace(/\\/g, "/")}. Use double quotes for every string or escape any quotes within the strings. Don't use Typescript annotations, use pure javascript. Include:
    - A description of what the component does.
    - Example stories (basic usage).

  
    The component is located at ${path.basename(componentFileLocation)}, use this in the imports as is.
    The full file source is:\n\n\n${full_source_code}\n\n\n
    The component is a ${isDefualtExported ? 'default export' : 'named export'}.

    Here's the component code:
    ${source}`;
    
        const story_content = await this.#ai_execute_prompt(prompt);
        
        const storyFilePath = path.join(
          storybookDir,
          `${componentName}_${path.basename(componentFileLocation, '.jsx')}.stories.js`
        );
    
        await fs.writeFile(storyFilePath, story_content, "utf-8");
    };

    /**
     * @param {import("simple-git").SimpleGit} git 
     * @param {string} temporary_directory
     */
    async #clone_repository(git, temporary_directory) {
        await git.clone(`https://github.com/${this.owner}/${this.repo_name}.git`, temporary_directory);
        await git.checkout(this.branch_name);
        consola.info("Repository cloned to:", temporary_directory);
    };


    /**
     * 
     * @param {string} dirPath 
     * @param {string[]} arrayOfFiles 
     * @returns {string[]}
     */
    #get_all_files(dirPath, arrayOfFiles){
        const files = fs.readdirSync(dirPath);
  
        arrayOfFiles = arrayOfFiles || [];

        for (const file of files) {
            if (fs.statSync(path.join(dirPath, file)).isDirectory() && ['node_modules', '.git'].indexOf(file) === -1) {
                arrayOfFiles = this.#get_all_files(path.join(dirPath, file), arrayOfFiles);
            } else if (file.endsWith(".jsx")) {
                arrayOfFiles.push(path.join(dirPath, file));
            }
        }
  
        return arrayOfFiles;
    };

    /**
     * 
     * @param {t.ParseResult} ast 
     */
    #add_prop_types_imports(ast) {
        let hasPropTypesImport = false;

        traverse.default(ast, {
          ImportDeclaration(path) {
            if (path.node.source.value === 'prop-types') {
              hasPropTypesImport = true;
            }
          },
        });

        if (!hasPropTypesImport) {
          const propTypesImport = t.importDeclaration(
            [t.importDefaultSpecifier(t.identifier('PropTypes'))],
            t.stringLiteral('prop-types')
          );
          ast.program.body.unshift(propTypesImport);
        }
    };

    /**
     * @param {import("simple-git").SimpleGit} git
     */
    async commit_and_push_changes(git) {
        await git.checkoutLocalBranch(this.documentation_branch_name);
        await git.add(".");
        await git.commit("Add Storybook documentation");
        await git.push("origin", this.documentation_branch_name);
    };


    /**
     * 
     * @returns {string}
     */
    async create_pull_request() {
        const { data: pr } = await this.octokit.rest.pulls.create({
            owner: this.owner,
            repo: this.repo_name,
            title: "Documentation",
            head: this.documentation_branch_name,
            base: this.branch_name,
            body: "This PR adds Storybook documentation for React components.",
        });

        return pr.html_url;
    };

    /**
     * 
     * @param {number} file_limits 
     * @param {string} temporary_directory
     * 
     */
    async loop_and_add_documentation_to_files(file_limits, temporary_directory) {
        const tracker_file = path.join(temporary_directory, ".daluri-documenation-tracker.json");
        const tracker = fs.existsSync(tracker_file) ? JSON.parse(await fs.readFile(tracker_file, "utf-8")) : {};


        const jsx_files = this.#get_all_files(temporary_directory);
        let processed_files = 0;

        const selfThis = this;

        for (const file of jsx_files) {
            try {
                if (processed_files >= file_limits) {
                    break;
                }

                consola.info(`Processing file: ${file}`);
    
                const source = await fs.readFile(file, "utf-8");
                const current_hash = this.#generate_hash(source);

                // standardize the file path ( linux format )
                const component_name = file.substring(file.indexOf("src")).replace(/\\/g, "/");

                if (tracker[component_name] && tracker[component_name].hash === current_hash) {
                    continue;
                }

                const asyncTasks = [];
                const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });

                const file_directory = path.dirname(file);
                const component_file = path.basename(file);
                const component_path = path.join(file_directory, component_file);

                traverse.default(ast, {
                    VariableDeclarator(path) {
                        const { init, id } = path.node;
            
                        if (init?.type === 'ArrowFunctionExpression' && id?.type === 'Identifier' && path.parentPath.parent.type === 'Program') {
                            const body = init.body;
                
                            const isReactComponent =
                                body.type === 'JSXElement' ||
                                (body.type === 'BlockStatement' &&
                                body.body.some(
                                    (statement) =>
                                        statement.type === 'ReturnStatement' &&
                                        (statement.argument?.type === 'JSXElement' || statement.argument?.type === 'JSXFragment')
                                ));
                
                            if (!isReactComponent) {
                                return;
                            }
                
                            const component_name = id.name;
                            const component_source_code = source.slice(path.node.start, path.node.end);
                
                            // Check if the component is exported
                            let parentNode = path.parentPath.parent.type === 'File' ? path.parentPath.parent.program : path.parentPath.parent;

                            const isDefualtExported = parentNode.body.some(
                                (node) => node.type === 'ExportDefaultDeclaration' && node.declaration === path.node
                            );

                            asyncTasks.push((async () => {
                                await Promise.all([
                                    (async () => {
                                        const isAlreadyExported = parentNode.body.some(
                                            (node) =>
                                              (node.type === 'ExportNamedDeclaration' && node.declaration === path.node) ||
                                              (node.type === 'ExportDefaultDeclaration' && node.declaration === path.node)
                                        );

                                        const [docstrings, proptypes] = await Promise.all([
                                            selfThis.#generate_jsdocs(component_name, component_source_code), 
                                            selfThis.#generate_proptypes(component_name, component_source_code)
                                        ]);

                                        const variable_declarator_index = parentNode.body.findIndex(
                                            (node) => (node?.declarations?.[0]?.type === path.node.type) && (node?.declarations?.[0]?.id?.name === path.node.id.name)
                                        );

                                        parentNode.body.splice(variable_declarator_index, 0, t.noop());

                                        parentNode.body[variable_declarator_index].leadingComments = [{
                                            type: 'CommentBlock',
                                            value: docstrings.replace('/*', '').replace('*/', '')
                                        }];

                                        if (!isAlreadyExported) {
                                            const variableDeclaration = t.variableDeclaration("const", [path.node]);
                                            path.parentPath.replaceWith(t.exportNamedDeclaration(variableDeclaration, []));
                                        }

                                        const propTypesNode = t.expressionStatement(t.identifier(selfThis.#replace_last_occurrence(proptypes.replace(`import PropTypes from 'prop-types';`, ''), ';', '')));

                                        parentNode.body.splice(variable_declarator_index + 2, 0, propTypesNode);
                                    })(),
                    
                                    selfThis.#generate_storybook_file(path.node.id.name, component_source_code, source, file_directory, component_file, component_path, isDefualtExported)
                                ]);
                            })());
                        }
                    },
                    
                    FunctionDeclaration(path) {
                        const { id, body } = path.node;
                        if (id && /^[A-Z]/.test(id.name)) {
                            const isReactComponent = body.body.some(
                                (statement) =>
                                statement.type === 'ReturnStatement' &&
                                (statement.argument?.type === 'JSXElement' || statement.argument?.type === 'JSXFragment')
                            );
                
                            if (!isReactComponent) {
                                return;
                            }

                            const component_name = id.name;
                            const component_source_code = source.slice(path.node.start, path.node.end);
                
                            let parentNode = path.parentPath.parent;
                            
                            if (parentNode.type === 'File') {
                                parentNode = parentNode.program;
                            }

                            const isDefualtExported = parentNode.body.some(
                                (node) => node.type === 'ExportDefaultDeclaration' && node.declaration === path.node
                            );

                            asyncTasks.push((async () => {

                                await Promise.all([
                                    (async () => {
                                        const isAlreadyExported = parentNode.body.some(
                                            (node) =>
                                              (node.type === 'ExportNamedDeclaration' && node.declaration === path.node) ||
                                              (node.type === 'ExportDefaultDeclaration' && node.declaration === path.node)
                                        );

                                        const [docstrings, proptypes] = await Promise.all([
                                            selfThis.#generate_jsdocs(component_name, component_source_code), 
                                            selfThis.#generate_proptypes(component_name, component_source_code)
                                        ]);

                                        const function_index = parentNode.body.findIndex((node) => 
                                            (node === path.node) || ((node?.declaration?.type === path.node.type) && (node?.declaration?.id?.name === path.node.id.name))
                                        );

                                        parentNode.body.splice(function_index, 0, t.noop());

                                        parentNode.body[function_index].leadingComments = [{
                                            type: 'CommentBlock',
                                            value: docstrings.replace('/*', '').replace('*/', '')
                                        }];

                                        if (!isAlreadyExported) {
                                            path.replaceWith(t.exportNamedDeclaration(path.node, []));
                                        }
                    
                                        const propTypesNode = t.expressionStatement(t.identifier(selfThis.#replace_last_occurrence(proptypes.replace(`import PropTypes from 'prop-types';`, ''), ';', '')));
                                        parentNode.body.splice(function_index + 2, 0, propTypesNode);
                                    })(),
                                    selfThis.#generate_storybook_file(path.node.id.name, component_source_code, source, file_directory, component_file, component_path, isDefualtExported)
                                ]);
                            })());
                        }
                    },
                    
                    ClassDeclaration(path) {
                        const { id, superClass } = path.node;
                        if (superClass?.type === 'MemberExpression' && superClass.object.name === 'React') {
                            const component_name = id.name;
                            const component_source_code = source.slice(path.node.start, path.node.end);

                            const isDefualtExported = parentNode.body.some(
                                (node) => node.type === 'ExportDefaultDeclaration' && node.declaration === path.node
                            );

                            asyncTasks.push((async () => {
                                await Promise.all([
                                    (async () => {
                                        const [docstrings, proptypes] = await Promise.all([
                                            selfThis.#generate_jsdocs(component_name, component_source_code),
                                            selfThis.#generate_proptypes(component_name, component_source_code)
                                        ]);
                    
                                        path.parentPath.addComment('leading', docstrings.replace('/*', '').replace('*/', ''));

                                        const propTypesNode = t.expressionStatement(t.identifier(selfThis.#replace_last_occurrence(proptypes.replace(`import PropTypes from 'prop-types';`, ''), ';', '')));
                                        path.parentPath.parent.body.push(propTypesNode);
                                    })(),
                                    selfThis.#generate_storybook_file(path.node.id.name, component_source_code, source, file_directory, component_file, component_path, isDefualtExported)
                                ]);
                            })());
                        }
                    },
            
                    CallExpression(path) {
                        const { callee, arguments: args } = path.node;
                    
                        if (
                            callee.type === 'MemberExpression'    &&
                            callee.object.name === 'React'        &&
                            callee.property.name === 'forwardRef' &&
                            args.length === 1                     &&
                            args[0].type === 'ArrowFunctionExpression'
                        ) {
                            const parentVariableDeclarator = path.findParent((parent) => parent.isVariableDeclarator());
                        
                            if (parentVariableDeclarator) {
                                const component_name = parentVariableDeclarator.node.id.name;
                                const component_source_code = source.slice(path.node.start, path.node.end);

                                // const isDefualtExported = parentNode.body.some(
                                //     (node) => node.type === 'ExportDefaultDeclaration' && node.declaration === path.node
                                // );
                        
                                asyncTasks.push(
                                    (async () => {
                                        await Promise.all([
                                            (async () => {
                                                const [docstrings, proptypes] = await Promise.all([
                                                    selfThis.#generate_jsdocs(component_name, component_source_code),
                                                    selfThis.#generate_proptypes(component_name, component_source_code),
                                                ]);
                                
                                                parentVariableDeclarator.parentPath.addComment('leading',docstrings.replace('/*', '').replace('*/', ''));
                                
                                                const propTypesNode = t.expressionStatement(
                                                    t.identifier(selfThis.#replace_last_occurrence(proptypes.replace( `import PropTypes from 'prop-types';`, '' ), ';', ''))
                                                );
                                
                                                parentVariableDeclarator.parentPath.parent.body.push(propTypesNode);
                                            })(),
                                            selfThis.#generate_storybook_file(component_name, component_source_code, source, file_directory, component_file, component_path)
                                        ]);
                                    })()
                                );
                            }
                        }
                    }
                });

                await Promise.all(asyncTasks);

                // add proptypes imports
                this.#add_prop_types_imports(ast);

                const patched_code = await prettier.format(generate(ast, {}, source).code, {
                    parser: "babel"
                });

                tracker[component_file] = { hash: this.#generate_hash(patched_code) };

                await fs.writeFile(file, patched_code, "utf-8");

                processed_files += 1;
            } catch (error) {
                console.error(`Error processing file: ${file}`, error);
            }

            await fs.writeFile(tracker_file, JSON.stringify(tracker, null, 2), "utf-8");
        }
    }

    async run() {
        if (this.mode === 'local') {
            await this.loop_and_add_documentation_to_files(this.file_limits, this.local_path);
            return;
        }

        const { path: temporary_directory, cleanup } = await tmpFiles.dir({
            unsafeCleanup: true,
            keep: true,
        });

        try {
            const git = simpleGit(temporary_directory);

            await this.#clone_repository(git, temporary_directory);
            await this.loop_and_add_documentation_to_files(this.file_limits, temporary_directory);
            await this.commit_and_push_changes(git);

            return this.create_pull_request();;
        } finally {
            cleanup();
        }
    }
}

export default ReactAutoDocumenter;