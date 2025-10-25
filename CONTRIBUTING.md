# Contributing to @dexie-kit/sync

Thank you for your interest in contributing to @dexie-kit/sync! 🎉

## Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/dexie-kit-sync.git
   cd dexie-kit-sync
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Run tests:
   ```bash
   npm test
   ```

5. Build the project:
   ```bash
   npm run build
   ```

## Development Workflow

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and ensure:
   - All tests pass: `npm test`
   - Code is linted: `npm run lint`
   - Types are valid: `npm run typecheck`
   - Build succeeds: `npm run build`

3. Commit your changes:
   ```bash
   git commit -m "Description of your changes"
   ```

4. Create a changeset (for version-worthy changes):
   ```bash
   npm run changeset
   ```
   - Select the appropriate version bump (patch, minor, or major)
   - Write a summary of the changes for the changelog
   - Commit the generated changeset file

5. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

6. Create a Pull Request

## Code Style

- Use TypeScript for all code
- Follow existing code style (enforced by ESLint and Prettier)
- Add JSDoc comments for public APIs
- Write tests for new features

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management and changelog generation.

### When to create a changeset:

- **Bug fixes** (patch): Create a changeset with type "patch"
- **New features** (minor): Create a changeset with type "minor"  
- **Breaking changes** (major): Create a changeset with type "major"
- **Documentation only**: No changeset needed
- **Tests only**: No changeset needed

### How to create a changeset:

```bash
npm run changeset
```

Follow the prompts to describe your changes. The changeset file should be committed with your PR.

For more details, see [PUBLISHING.md](./PUBLISHING.md).

## Testing

- Write unit tests for new functionality
- Ensure existing tests still pass
- Test files should be placed in the `test/` directory
- Use Vitest for testing

## Commit Messages

- Use clear, descriptive commit messages
- Start with a verb (Add, Fix, Update, Remove, etc.)
- Keep the first line under 72 characters
- Add more details in the commit body if needed

Example:
```
Add support for custom pagination strategies

- Implement cursor-based pagination
- Add offset-based pagination
- Update documentation with examples
```

## Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Update documentation if needed
- Add tests for new functionality
- Ensure all CI checks pass
- Link related issues

## Reporting Bugs

When reporting bugs, please include:

- @dexie-kit/sync version (published from dexie-kit-sync repository)
- Dexie version
- Browser/Node.js version
- Steps to reproduce
- Expected vs actual behavior
- Any error messages or logs

## Feature Requests

We welcome feature requests! Please:

- Check if the feature has already been requested
- Explain the use case
- Provide examples if possible
- Consider contributing the implementation

## Questions?

- Check the [documentation](./README.md)
- Look at [examples](./examples/)
- Open an issue for discussion

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
