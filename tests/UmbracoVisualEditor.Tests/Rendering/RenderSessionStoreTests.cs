using System.Text.Json;
using UmbracoVisualEditor.Rendering;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace UmbracoVisualEditor.Tests.Rendering;

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

    [Fact]
    public async Task Create_StoresAClearedValueAsNull()
    {
        // A picker the editor emptied: its value is left out of the request, so it binds as an undefined element.
        var created = await _store.CreateAsync(
            Guid.NewGuid(),
            null,
            null,
            [new RenderValue("heroImage", null, null, default)],
            [],
            Guid.NewGuid(),
            TestContext.Current.CancellationToken);

        var loaded = await _store.GetAsync(created.Token, TestContext.Current.CancellationToken);
        Assert.Equal(JsonValueKind.Null, Assert.Single(loaded!.Values).Value.ValueKind);
    }

    [Fact]
    public async Task ViewerPass_IdentifiesTheUserItWasIssuedTo()
    {
        var user = Guid.NewGuid();
        var pass = await _store.IssueViewerPassAsync(user, current: null, TestContext.Current.CancellationToken);

        Assert.Equal(user, await _store.GetViewerAsync(pass, TestContext.Current.CancellationToken));
        Assert.Null(await _store.GetViewerAsync("not-a-pass", TestContext.Current.CancellationToken));
        Assert.Null(await _store.GetViewerAsync(null, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ViewerPass_IsKeptForTheSameUser_ButNotTakenOverByAnother()
    {
        var first = Guid.NewGuid();
        var pass = await _store.IssueViewerPassAsync(first, current: null, TestContext.Current.CancellationToken);

        Assert.Equal(pass, await _store.IssueViewerPassAsync(first, pass, TestContext.Current.CancellationToken));

        // Another user signing in on the same browser gets a pass of their own; the first user's still means them.
        var second = Guid.NewGuid();
        var other = await _store.IssueViewerPassAsync(second, pass, TestContext.Current.CancellationToken);
        Assert.NotEqual(pass, other);
        Assert.Equal(second, await _store.GetViewerAsync(other, TestContext.Current.CancellationToken));
        Assert.Equal(first, await _store.GetViewerAsync(pass, TestContext.Current.CancellationToken));
    }
}
