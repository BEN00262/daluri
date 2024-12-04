#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import os from 'os';
import { program } from 'commander';
import consola from 'consola';
import ReactAutoDocumenter from './tool.js';

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
        .version('0.0.1')
        .requiredOption('--branch_name <string>', 'Branch name')
        .requiredOption('--repo_name <string>', 'Repository name')
        .requiredOption('--owner <string>', 'Repository owner')
        .option('--file-limits <number>', 'Limit the number of files', parseInt, 1)
        .option('--build-tool <string>', 'Build tool to use (e.g., webpack, vite)', 'webpack')
        .action(async (options) => {

            const autoDocumenter = new ReactAutoDocumenter(options.repo_name, options.branch_name, options.owner, options.fileLimits, options.buildTool);
            const pr_url = await autoDocumenter.run();

            consola.info(pr_url);
        });

    // Parse the arguments
    program.parse(process.argv);

    // Show help if no arguments are passed
    if (!process.argv.slice(2).length) {
        program.help();
    }
})();

