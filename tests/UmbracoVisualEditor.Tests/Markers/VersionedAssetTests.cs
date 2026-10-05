using Microsoft.Extensions.FileProviders;
using UmbracoVisualEditor.Markers;

namespace UmbracoVisualEditor.Tests.Markers;

public sealed class VersionedAssetTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("uve-assets-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private string? Url(string path)
    {
        using var files = new PhysicalFileProvider(_root);
        return VersionedAsset.Url(files, path);
    }

    private void Write(string name, string content, DateTime modified)
    {
        var file = Path.Combine(_root, name);
        File.WriteAllText(file, content);
        File.SetLastWriteTimeUtc(file, modified);
    }

    [Fact]
    public void Url_IsNullForAMissingFile()
        => Assert.Null(Url($"/missing-{Guid.NewGuid()}.css"));

    [Fact]
    public void Url_HasAVersionFromTheContent()
    {
        var name = $"{Guid.NewGuid()}.js";
        Write(name, "console.log(1);", new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));

        Assert.Matches($"^/{name}\\?v=[0-9a-f]{{12}}$", Url($"/{name}"));
    }

    [Fact]
    public void Url_ChangesWhenTheFileDoes()
    {
        var name = $"{Guid.NewGuid()}.js";
        Write(name, "console.log(1);", new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var before = Url($"/{name}");

        Write(name, "console.log(2);", new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Utc));

        Assert.NotEqual(before, Url($"/{name}"));
    }
}
