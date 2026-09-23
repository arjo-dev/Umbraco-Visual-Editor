using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.Cache;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Wraps Umbraco's runtime cache so that, during edit-mode (render-session) requests, cached partial views
/// (<c>Html.CachedPartialAsync</c>) are always rendered fresh and never stored. Otherwise a render session could:
/// <list type="bullet">
/// <item>fill the shared cache with output containing edit-mode markers and unsaved values, which live visitors
/// would then be served (reproduced on the Test Site with <c>Hosting:Debug=false</c>); and</item>
/// <item>show live cached output, without markers or the editor's changes, in the canvas.</item>
/// </list>
/// Umbraco itself skips this cache in debug mode and preview, which is why development sites don't show it.
/// Every other cache call passes straight through.
/// </summary>
internal sealed class EditModeRuntimeCache(IAppPolicyCache inner, IHttpContextAccessor httpContextAccessor) : IAppPolicyCache
{
    // CacheHelperExtensions.PartialViewCacheKey in Umbraco.Core.
    private const string PartialViewCacheKeyPrefix = "Umbraco.Web.PartialViewCacheKey";

    public IAppPolicyCache Inner => inner;

    private bool Bypass(string key)
        => key.StartsWith(PartialViewCacheKeyPrefix, StringComparison.Ordinal)
           && EditModeRequest.Get(httpContextAccessor.HttpContext) is not null;

    public object? Get(string key) => Bypass(key) ? null : inner.Get(key);

    public object? Get(string key, Func<object?> factory) => Bypass(key) ? factory() : inner.Get(key, factory);

    public object? Get(string key, Func<object?> factory, TimeSpan? timeout, bool isSliding = false)
        => Bypass(key) ? factory() : inner.Get(key, factory, timeout, isSliding);

    public void Insert(string key, Func<object?> factory, TimeSpan? timeout = null, bool isSliding = false)
    {
        if (!Bypass(key))
        {
            inner.Insert(key, factory, timeout, isSliding);
        }
    }

    public IEnumerable<object?> SearchByKey(string keyStartsWith) => inner.SearchByKey(keyStartsWith);

    public IEnumerable<object?> SearchByRegex(string regex) => inner.SearchByRegex(regex);

    public void Clear() => inner.Clear();

    public void Clear(string key) => inner.Clear(key);

    public void ClearOfType(Type type) => inner.ClearOfType(type);

    public void ClearOfType<T>() => inner.ClearOfType<T>();

    public void ClearOfType<T>(Func<string, T, bool> predicate) => inner.ClearOfType(predicate);

    public void ClearByKey(string keyStartsWith) => inner.ClearByKey(keyStartsWith);

    public void ClearByRegex(string regex) => inner.ClearByRegex(regex);
}
