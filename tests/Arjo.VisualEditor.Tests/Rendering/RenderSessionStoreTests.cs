using System.Text.Json;
using Arjo.VisualEditor.Rendering;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace Arjo.VisualEditor.Tests.Rendering;

public class RenderSessionStoreTests
{
    private readonly RenderSessionStore _store =
        new(new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())));

    [Fact]
    public async Task CreateThenGet_RoundTripsValuesAndNames()
    {
        var blocks = JsonDocument.Parse("""{"layout":{},"contentData":[{"key":"k","values":[]}],"settingsData":[]}""").RootElement;
        var documentKey = Guid.NewGuid();
        var userKey = Guid.NewGuid();

        var created = await _store.CreateAsync(
            documentKey,
            "da-DK",
            null,
            [new RenderValue("title", "da-DK", null, JsonDocument.Parse("\"Ændret\"").RootElement), new RenderValue("grid", null, null, blocks)],
            [new RenderVariantName("da-DK", null, "Omdøbt")],
            userKey,
            TestContext.Current.CancellationToken);

        var loaded = await _store.GetAsync(created.Token, TestContext.Current.CancellationToken);

        Assert.NotNull(loaded);
        Assert.Equal((documentKey, "da-DK", userKey), (loaded.DocumentKey, loaded.Culture, loaded.UserKey));
        Assert.Equal("Ændret", loaded.Values[0].Value.GetString());
        Assert.Equal(blocks.GetRawText(), loaded.Values[1].Value.GetRawText());
        Assert.Equal(new RenderVariantName("da-DK", null, "Omdøbt"), Assert.Single(loaded.Variants));
    }

    [Fact]
    public async Task Get_UnknownToken_ReturnsNull()
        => Assert.Null(await _store.GetAsync(Guid.NewGuid(), TestContext.Current.CancellationToken));

    [Fact]
    public async Task Create_IssuesUniqueTokens()
    {
        var a = await _store.CreateAsync(Guid.NewGuid(), null, null, [], [], Guid.Empty, TestContext.Current.CancellationToken);
        var b = await _store.CreateAsync(Guid.NewGuid(), null, null, [], [], Guid.Empty, TestContext.Current.CancellationToken);

        Assert.NotEqual(a.Token, b.Token);
    }
}
