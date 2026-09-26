using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

namespace UmbracoVisualEditor.Rendering;

/// <summary>An editor-format property value, as the backoffice document workspace holds it.</summary>
public sealed record RenderValue(string Alias, string? Culture, string? Segment, JsonElement Value);

/// <summary>The (possibly unsaved) name of one variant of the document.</summary>
public sealed record RenderVariantName(string? Culture, string? Segment, string Name);

/// <summary>A snapshot of unsaved workspace values to render, addressed by an unguessable token.</summary>
public sealed record RenderSession(
    Guid Token,
    Guid DocumentKey,
    string? Culture,
    string? Segment,
    IReadOnlyList<RenderValue> Values,
    IReadOnlyList<RenderVariantName> Variants,
    Guid UserKey);

/// <summary>
/// Short-lived store of render sessions. Uses <see cref="IDistributedCache"/> so load-balanced backoffices work
/// with whatever distributed cache the site registers (Redis, SQL Server, ...); the default is in-memory.
/// </summary>
public sealed class RenderSessionStore(IDistributedCache cache)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonElement NullValue = JsonDocument.Parse("null").RootElement.Clone();

    public async Task<RenderSession> CreateAsync(
        Guid documentKey,
        string? culture,
        string? segment,
        IEnumerable<RenderValue> values,
        IEnumerable<RenderVariantName> variants,
        Guid userKey,
        CancellationToken cancellationToken = default)
    {
        var session = new RenderSession(
            Guid.NewGuid(),
            documentKey,
            culture,
            segment,
            // A value the editor cleared (a picker emptied) arrives missing: store it as null, which JSON can hold.
            values.Select(v => v.Value.ValueKind == JsonValueKind.Undefined ? v with { Value = NullValue } : v).ToList(),
            variants.ToList(),
            userKey);

        await cache.SetAsync(
            Key(session.Token),
            JsonSerializer.SerializeToUtf8Bytes(session, JsonOptions),
            new DistributedCacheEntryOptions { SlidingExpiration = Lifetime },
            cancellationToken);
        return session;
    }

    public async Task<RenderSession?> GetAsync(Guid token, CancellationToken cancellationToken = default)
    {
        var bytes = await cache.GetAsync(Key(token), cancellationToken);
        return bytes is null ? null : JsonSerializer.Deserialize<RenderSession>(bytes, JsonOptions);
    }

    /// <summary>
    /// A pass for the browser a user creates sessions from (#34): a random secret for the user, which the render page
    /// must be requested with. <paramref name="current"/> is kept (and its lifetime extended) if it's still this user's.
    /// </summary>
    public async Task<string> IssueViewerPassAsync(Guid userKey, string? current, CancellationToken cancellationToken = default)
    {
        var pass = current is not null && await GetViewerAsync(current, cancellationToken) == userKey
            ? current
            : Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        await cache.SetAsync(
            ViewerKey(pass),
            userKey.ToByteArray(),
            new DistributedCacheEntryOptions { SlidingExpiration = Lifetime },
            cancellationToken);
        return pass;
    }

    /// <summary>The user a viewer pass was issued to; null when it's unknown or expired.</summary>
    public async Task<Guid?> GetViewerAsync(string? pass, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(pass) || pass.Length > 128)
        {
            return null;
        }

        var bytes = await cache.GetAsync(ViewerKey(pass), cancellationToken);
        return bytes is { Length: 16 } ? new Guid(bytes) : null;
    }

    private static string Key(Guid token) => $"UmbracoVisualEditor.RenderSession.{token:N}";

    private static string ViewerKey(string pass) => $"UmbracoVisualEditor.Viewer.{pass}";
}
