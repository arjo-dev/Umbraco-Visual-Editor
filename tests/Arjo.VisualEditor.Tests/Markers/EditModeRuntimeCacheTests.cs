using Arjo.VisualEditor.Markers;
using Arjo.VisualEditor.Rendering;
using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.Cache;

namespace Arjo.VisualEditor.Tests.Markers;

public class EditModeRuntimeCacheTests
{
    private const string PartialKey = "Umbraco.Web.PartialViewCacheKey~/Views/Partials/nav.cshtml";
    private const string OtherKey = "Some.Other.CacheKey";

    private readonly ObjectCacheAppCache _inner = new();
    private readonly DefaultHttpContext _httpContext = new();
    private readonly EditModeRuntimeCache _cache;

    public EditModeRuntimeCacheTests()
        => _cache = new EditModeRuntimeCache(_inner, new HttpContextAccessor { HttpContext = _httpContext });

    private void EnterEditMode()
        => EditModeRequest.Set(_httpContext, new EditModeRequest(new RenderSession(Guid.NewGuid(), Guid.NewGuid(), null, null, [], [], Guid.Empty)));

    [Fact]
    public void NormalRequest_CachesPartials()
    {
        var calls = 0;
        _cache.Get(PartialKey, () => ++calls, TimeSpan.FromMinutes(1));
        _cache.Get(PartialKey, () => ++calls, TimeSpan.FromMinutes(1));

        Assert.Equal(1, calls);
        Assert.NotNull(_inner.Get(PartialKey));
    }

    [Fact]
    public void EditMode_RendersPartialsFreshAndNeverStoresThem()
    {
        EnterEditMode();
        var calls = 0;

        _cache.Get(PartialKey, () => ++calls, TimeSpan.FromMinutes(1));
        _cache.Get(PartialKey, () => ++calls);
        _cache.Insert(PartialKey, () => "session output");

        Assert.Equal(2, calls);
        Assert.Null(_inner.Get(PartialKey));
    }

    [Fact]
    public void EditMode_IgnoresPartialsCachedByLiveRequests()
    {
        _inner.Get(PartialKey, () => "live output", TimeSpan.FromMinutes(1));
        EnterEditMode();

        Assert.Null(_cache.Get(PartialKey));
        Assert.Equal("session output", _cache.Get(PartialKey, () => "session output", TimeSpan.FromMinutes(1)));
        Assert.Equal("live output", _inner.Get(PartialKey));
    }

    [Fact]
    public void EditMode_LeavesOtherCacheEntriesAlone()
    {
        EnterEditMode();
        var calls = 0;

        _cache.Get(OtherKey, () => ++calls, TimeSpan.FromMinutes(1));
        _cache.Get(OtherKey, () => ++calls, TimeSpan.FromMinutes(1));

        Assert.Equal(1, calls);
        Assert.NotNull(_inner.Get(OtherKey));
    }
}
