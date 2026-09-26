# Releasing

A release publishes two NuGet packages from the same commit, one per Umbraco major. A single build can't serve both (see [compatibility.md](compatibility.md#umbraco-versions)).

| Tag | Umbraco 18 package | Umbraco 17 package |
|---|---|---|
| `v1.0` | `UmbracoVisualEditor` **18.1.0** | `UmbracoVisualEditor` **17.1.0** |
| `v1.2` | 18.1.2 | 17.1.2 |
| `v1.3-beta.1` | 18.1.3-beta.1 (prerelease) | 17.1.3-beta.1 (prerelease) |

The package's major is the Umbraco major, so it's clear which one to install. Each package depends on its own major only: `[18.2.0, 19.0.0)` and `[17.7.0, 18.0.0)`, from the Umbraco version it's built against.

## How to release

1. Move the changes under **Unreleased** in [CHANGELOG.md](../CHANGELOG.md) into a section for the release, e.g. `## [1.0] - 2026-10-01` (packages 18.1.0 and 17.1.0), and merge that to `main`.
2. Tag the commit on `main` and push the tag:

   ```bash
   git tag v1.0
   git push origin v1.0
   ```

The [release workflow](../.github/workflows/release.yml) then:
1. runs all of CI, on Umbraco 18 and 17;
2. packs both packages, and checks their Umbraco dependency ranges;
3. **installs each package into the Compat Site**, as a site would, and runs its end-to-end tests against it, so what's published is what was tested;
4. creates a GitHub Release with both packages attached (a prerelease for a tag with a suffix);
5. pushes both to nuget.org, if the repository has a `NUGET_API_KEY` secret. Without one, the packages are only on the GitHub Release.

A tag that isn't `vY.Z` or `vY.Z-suffix` fails the release before anything is built.

## Setting up nuget.org

Create an API key on nuget.org, scoped to push `UmbracoVisualEditor`, and add it as the repository secret `NUGET_API_KEY` (Settings → Secrets and variables → Actions). The first push creates the package on nuget.org.

The package has the `umbraco-marketplace` tag, so the Umbraco Marketplace picks it up from nuget.org. The Marketplace can show more (screenshots, a category, links) from an `umbraco-marketplace.json` at the root of a public repository. The repository is private for now, so there isn't one yet.

## Trying a package locally

```bash
dotnet pack src/UmbracoVisualEditor -c Release -p:Version=18.0.0-local.1 -o artifacts
dotnet pack src/UmbracoVisualEditor -c Release -p:Version=17.0.0-local.1 -p:UmbracoVersion=17.7.0 -o artifacts
```

The Compat Site can use a packed package instead of the project: set `VisualEditorPackageVersion` and `RestoreAdditionalProjectSources` (both MSBuild properties, or environment variables):

```bash
cd tests/e2e
VisualEditorPackageVersion=18.0.0-local.1 RestoreAdditionalProjectSources="$PWD/../../artifacts" npm run test:compat
```

Use a new version each time: NuGet caches a package by its version.

## Updating Umbraco

The Umbraco version for the 18 line is `UmbracoVersion` in `Directory.Packages.props`. For 17, change `UMBRACO_17_VERSION` in `release.yml` and the Umbraco 17 job's `UmbracoVersion` in `ci.yml` together. The package's lower bound follows the version it's built against.
