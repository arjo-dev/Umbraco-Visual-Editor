using Microsoft.AspNetCore.OutputCaching;

namespace UmbracoVisualEditor.Rendering;

/// <summary>
/// Keeps render sessions out of ASP.NET output caching (#38). Output caching doesn't honour <c>Cache-Control:
/// no-store</c>: with a policy for all pages (a common way to switch it on), a render session was cached by its URL and
/// served again without the viewer check (#34), to anyone with the URL, for as long as it stayed cached. Added as the
/// last base policy (<see cref="Composers.RenderingComposer"/>), it stops both looking up and storing, so an endpoint's
/// policy switching caching on can't bring it back.
/// </summary>
internal sealed class RenderSessionOutputCachePolicy : IOutputCachePolicy
{
    private static bool IsRenderSession(OutputCacheContext context)
        => context.HttpContext.Request.Path.StartsWithSegments(
            RenderSessionContentFinder.PathPrefix.TrimEnd('/'),
            StringComparison.OrdinalIgnoreCase);

    public ValueTask CacheRequestAsync(OutputCacheContext context, CancellationToken cancellation)
    {
        if (IsRenderSession(context))
        {
            context.EnableOutputCaching = false;
            context.AllowCacheLookup = false;
            context.AllowCacheStorage = false;
        }

        return ValueTask.CompletedTask;
    }

    public ValueTask ServeFromCacheAsync(OutputCacheContext context, CancellationToken cancellation) => ValueTask.CompletedTask;

    public ValueTask ServeResponseAsync(OutputCacheContext context, CancellationToken cancellation)
    {
        if (IsRenderSession(context))
        {
            context.AllowCacheStorage = false;
        }

        return ValueTask.CompletedTask;
    }
}
