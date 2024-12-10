<p align="center" style="display: flex;flex-direction:column;align-items:center;gap:20px;">
    <img src="static/logo.jpg" alt="Daluri Logo" width="150" height="150">
    <a href="https://v0-daluri-l6ajb7fybns.vercel.app/">Daluri Website</a>
</p>

```markdown
# Daluri - React Auto Documentation Tool

Daluri is an open-source tool designed to automatically generate documentation for ReactJS codebases. It uses Storybook, inline comments, and PropTypes to document the entire codebase.

## Features

- Automatically generates JSDoc comments for React components.
- Creates Storybook stories for components.
- Adds PropTypes to components.
- Supports multiple build tools (e.g., webpack, vite).

```

## Usage

Daluri is a CLI tool that can be run from the command line. It requires a one-time setup to configure your GitHub and OpenAI API keys.

### One-Time Setup

When you run Daluri for the first time, it will prompt you to enter your GitHub Token and OpenAI API Key. These will be saved in a configuration file in your home directory.

### Running the Tool

To run Daluri, use the following command:

```sh
npx daluri github --branch <branch_name> --repo <repo_name> --owner <owner> [options]
```

### Options

- `--branch <string>`: The name of the branch to document.
- `--repo <string>`: The name of the repository.
- `--owner <string>`: The owner of the repository.
- `--file-limit <number>`: Limit the number of files to process (default: 1).
- `--build <string>`: The build tool to use (e.g., webpack, vite) (default: webpack).

### Example

```sh
npx daluri github --branch main --repo my-react-app --owner my-github-username --file-limit 5 --build webpack
```

## How It Works

1. **Clone Repository**: Daluri clones the specified repository and checks out the specified branch.
2. **Process Files**: It processes all `.jsx` files in the repository, generating JSDoc comments, PropTypes, and Storybook stories.
3. **Commit and Push**: Daluri commits the changes to a new branch and pushes it to the repository.
4. **Create Pull Request**: Finally, it creates a pull request with the generated documentation.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on GitHub.

## Author

Written by BEN00262. For more information, visit [GitHub](https://github.com/BEN00262).