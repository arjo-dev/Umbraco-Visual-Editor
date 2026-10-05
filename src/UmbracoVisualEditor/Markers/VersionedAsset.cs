using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.Extensions.FileProviders;

namespace UmbracoVisualEditor.Markers;

/// <summary>
/// URLs for static files with a version from their content (<c>?v=…</c>), so browsers fetch them again when they
/// change (a package upgrade, a rebuild, a site's edit) rather than going on with a cached copy.
/// </summary>
internal static class VersionedAsset
{
    private static readonly ConcurrentDictionary<string, (DateTimeOffset Modified, long Length, string Version)> Versions =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// <paramref name="path"/> with its version, or null when <paramref name="files"/> doesn't have it. The file is only
    /// read again when its modified time or length changes.
    /// </summary>
    public static string? Url(IFileProvider files, string path)
    {
        IFileInfo file = files.GetFileInfo(path);
        if (!file.Exists)
        {
            return null;
        }

        if (!Versions.TryGetValue(path, out var known) || known.Modified != file.LastModified || known.Length != file.Length)
        {
            known = (file.LastModified, file.Length, Hash(file));
            Versions[path] = known;
        }

        return $"{path}?v={known.Version}";
    }

    internal static string Hash(IFileInfo file)
    {
        using Stream stream = file.CreateReadStream();
        return Convert.ToHexStringLower(SHA256.HashData(stream))[..12];
    }
}
