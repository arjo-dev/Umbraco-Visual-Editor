using UmbracoVisualEditor.Rendering;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.OutputCaching;

namespace UmbracoVisualEditor.Tests.Rendering;

public class RenderSessionOutputCachePolicyTests
{
    private static OutputCacheContext ContextFor(string path)
    {
        var http = new DefaultHttpContext();
        http.Request.Path = path;
        // As a site's "cache every page" policy leaves it.
        return new OutputCacheContext
        {
            HttpContext = http,
            EnableOutputCaching = true,
            AllowCacheLookup = true,
            AllowCacheStorage = true,
        };
    }

    [Fact]
    public async Task RenderSessions_AreNeitherLookedUpNorStored()
    {
        var policy = new RenderSessionOutputCachePolicy();
        OutputCacheContext context = ContextFor("/__visual-editor/render/0123456789abcdef0123456789abcdef");

        await policy.CacheRequestAsync(context, TestContext.Current.CancellationToken);
        Assert.False(context.EnableOutputCaching);
        Assert.False(context.AllowCacheLookup);

        // An endpoint's policy switching caching back on still can't store it.
        context.AllowCacheStorage = true;
        await policy.ServeResponseAsync(context, TestContext.Current.CancellationToken);
        Assert.False(context.AllowCacheStorage);
    }

    [Fact]
    public async Task OtherPages_AreLeftToTheSitesPolicies()
    {
        var policy = new RenderSessionOutputCachePolicy();
        OutputCacheContext context = ContextFor("/about/");

        await policy.CacheRequestAsync(context, TestContext.Current.CancellationToken);
        await policy.ServeResponseAsync(context, TestContext.Current.CancellationToken);

        Assert.True(context.EnableOutputCaching);
        Assert.True(context.AllowCacheLookup);
        Assert.True(context.AllowCacheStorage);
    }
}
