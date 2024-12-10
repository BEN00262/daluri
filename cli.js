#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import os from 'os';
import { Command } from 'commander';
import consola from 'consola';
import { exec } from 'child_process';
import { promisify } from 'util';
import tmpFiles from "tmp-promise";
import simpleGit from "simple-git";
import ReactAutoDocumenter from './tool.js';

const program = new Command();

async function vercel_hosting() {
    // check if vercel is available globally
    if (!fs.existsSync(path.join(os.homedir(), '.npm-global/bin/vercel'))) {
        consola.info('Installing vercel globally using `npm i -g vercel`');
        await exec('npm i -g vercel');
        consola.success('Vercel installed successfully');
    }

    // check if the user is logged in
    consola.info('Checking if you are logged in to vercel');
    await promisify(exec)('vercel whoami');

    // build the storybook docs
    consola.info('Building the storybook documentation');
    await promisify(exec)('npx storybook build');

    // deploy the storybook docs
    consola.info('Deploying the storybook documentation');
    const { stdout, stderr } = await promisify(exec)('vercel --prod');

    consola.success(stdout);
}

;(async () => {
    const envFile = path.join(os.homedir(), '.daluri.env');

    if (!fs.existsSync(envFile)) {
        consola.info('Please enter the required information to create the config file. This is a one-time setup');

        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'GITHUB_TOKEN',
                message: 'Enter your GitHub Token',
                required: true
            },
            {
                type: 'input',
                name: 'OPENAI_API_KEY',
                message: 'Enter your OpenAI API Key',
                required: true
            }
        ]);

        const env = Object.keys(answers).map(key => `${key}=${answers[key]}`).join('\n');
        fs.writeFileSync(envFile, env);
    }


    program
        .name('daluri')
        .description('A React auto documentation generation tool. Written by BEN00262 <https://github.com/BEN00262>')
        .version('0.0.1');


    program
        .command('github')    
        .requiredOption('--branch_name <string>', 'Branch name')
        .requiredOption('--repo_name <string>', 'Repository name')
        .requiredOption('--owner <string>', 'Repository owner')
        .option('--file-limits <number>', 'Limit the number of files', parseInt, 1)
        .option('--build-tool <string>', 'Build tool to use (e.g., webpack, vite)', 'webpack')
        .action(async (options) => {

            const autoDocumenter = new ReactAutoDocumenter(
                options.repo_name, options.branch_name, options.owner, 
                options.fileLimits, options.buildTool
            );

            const pr_url = await autoDocumenter.run();

            consola.success(pr_url);
        });

    program
        .command('local')
        .option('--path <string>', 'Path to the project', '.')
        .option('--file-limits <number>', 'Limit the number of files', parseInt, 1)
        .option('--build-tool <string>', 'Build tool to use (e.g., webpack, vite)', 'webpack')
        .action(async (options) => {

            const autoDocumenter = new ReactAutoDocumenter(
                null, null, null,
                options.path, options.fileLimits, options.buildTool
            );

            await autoDocumenter.run();
        });

    program
        .command('deploy-local')
        .requiredOption('--hoster <string>', 'Hoster to deploy to (e.g., vercel)')
        .option('--path <string>', 'Path to the project', '.')
        .action(async (options) => {

            // switch to folder
            process.chdir(options.path);

            switch (options.hoster) {
                case 'vercel':
                    await vercel_hosting();
                    break;
                default:
                    consola.error('Invalid hoster');
                    break;
            }
        });

    program
        .command('deploy-github')
        .requiredOption('--hoster <string>', 'Hoster to deploy to (e.g., vercel)')
        .option('--branch_name <string>', 'Branch name')
        .option('--repo_name <string>', 'Repository name')
        .option('--owner <string>', 'Repository owner')
        .action(async (options) => {
            const { path: temporary_directory, cleanup } = await tmpFiles.dir({
                unsafeCleanup: true,
                keep: true,
            });

            try {
                const autoDocumenter = new ReactAutoDocumenter(
                    options.repo_name, options.branch_name, options.owner, 
                    options.fileLimits, options.buildTool
                );

                const git = simpleGit(temporary_directory);
                await autoDocumenter.clone_repository(git, temporary_directory);

                // switch to folder
                process.chdir(temporary_directory);
    
                switch (options.hoster) {
                    case 'vercel':
                        await vercel_hosting();
                        break;
                    default:
                        consola.error('Invalid hoster');
                        break;
                }
            } catch (error) {
                consola.error(error);
            } finally {
                cleanup();
            }
        });

    // Parse the arguments
    program.parse(process.argv);

    // Show help if no arguments are passed
    if (!process.argv.slice(2).length) {
        program.help();
    }
})();

