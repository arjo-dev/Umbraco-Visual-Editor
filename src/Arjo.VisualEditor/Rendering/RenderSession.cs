using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;

namespace Arjo.VisualEditor.Rendering;

/// <summary>An editor-format property value, as the backoffice document workspace holds it.</summary>
public sealed record RenderValue(string Alias, string? Culture, string? Segment, JsonElement Value);

/// <summary>A snapshot of unsaved workspace values to render, addressed by an unguessable token.</summary>
public sealed record RenderSession(
    Guid Token,
    Guid DocumentKey,
    string? Culture,
    string? Segment,
    IReadOnlyList<RenderValue> Values,
    Guid UserKey);

/// <summary>Short-lived, in-memory store of render sessions.</summary>
public sealed class RenderSessionStore(IMemoryCache cache)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

    public RenderSession Create(Guid documentKey, string? culture, string? segment, IEnumerable<RenderValue> values, Guid userKey)
    {
        // Clone JSON so it outlives the request body it was parsed from.
        var session = new RenderSession(
            Guid.NewGuid(),
            documentKey,
            culture,
            segment,
            values.Select(v => v with { Value = v.Value.Clone() }).ToList(),
            userKey);
        cache.Set(Key(session.Token), session, new MemoryCacheEntryOptions { SlidingExpiration = Lifetime });
        return session;
    }

    public RenderSession? Get(Guid token) => cache.TryGetValue(Key(token), out RenderSession? s) ? s : null;

    private static string Key(Guid token) => $"Arjo.VisualEditor.RenderSession.{token:N}";
}
