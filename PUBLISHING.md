# Publishing Guide

This package is published to npm under the `@dexie-kit/sync` scope using [Changesets](https://github.com/changesets/changesets) for version management and GitHub Actions for automated publishing.

## Prerequisites

Before publishing, you need to:

1. Add the `NPM_TOKEN` secret to your GitHub repository:
   - Go to [npmjs.com](https://www.npmjs.com/) and create an access token with publish permissions
   - Go to your GitHub repository Settings → Secrets and variables → Actions
   - Add a new repository secret named `NPM_TOKEN` with your npm access token

## How to Release

### 1. Create a Changeset

When you make changes that should be released, create a changeset:

```bash
npm run changeset
```

This will prompt you to:
- Select the type of change (major, minor, or patch)
- Write a summary of the changes

This creates a markdown file in the `.changeset` directory that will be included in your PR.

### 2. Merge to Main

When your PR with the changeset is merged to the `main` branch, the GitHub Actions workflow will automatically:

1. Create a "Version Packages" PR that:
   - Updates the version in `package.json`
   - Generates/updates `CHANGELOG.md`
   - Removes the consumed changesets

### 3. Publish to npm

When you merge the "Version Packages" PR to `main`, the workflow will:

1. Build the package
2. Publish it to npm under `@dexie-kit/sync`
3. Create a GitHub release

## Manual Publishing (for maintainers)

If you need to publish manually:

```bash
# 1. Update version and changelog
npm run version

# 2. Build and publish
npm run release
```

Note: You need to be logged in to npm with an account that has publish access to the `@dexie-kit` scope.

## Changeset Types

- **patch**: Bug fixes and small changes (1.0.0 → 1.0.1)
- **minor**: New features (1.0.0 → 1.1.0)
- **major**: Breaking changes (1.0.0 → 2.0.0)

## Example Workflow

```bash
# Make your changes
git checkout -b feature/my-feature

# Create a changeset
npm run changeset
# Select "minor" for a new feature
# Write: "Add support for custom retry strategies"

# Commit and push
git add .
git commit -m "feat: add custom retry strategies"
git push origin feature/my-feature

# Create and merge PR
# The changeset file will be included

# After merge, a "Version Packages" PR will be created automatically
# Review and merge it to publish to npm
```

## Scope Configuration

The package is configured to publish under the `@dexie-kit` scope:
- Package name: `@dexie-kit/sync`
- Access: public
- Registry: https://registry.npmjs.org

This is configured in:
- `package.json` → `"name": "@dexie-kit/sync"`
- `package.json` → `"publishConfig": { "access": "public" }`
- `.changeset/config.json` → `"access": "public"`
