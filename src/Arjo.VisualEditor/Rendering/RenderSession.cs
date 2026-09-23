using System.Text.Json;
using Microsoft.Extensions.Caching.Distributed;

namespace Arjo.VisualEditor.Rendering;

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
            values.ToList(),
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

    private static string Key(Guid token) => $"Arjo.VisualEditor.RenderSession.{token:N}";
}
