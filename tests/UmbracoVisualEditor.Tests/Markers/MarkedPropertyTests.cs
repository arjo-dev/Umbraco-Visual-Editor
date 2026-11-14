using System.Reflection;
using Microsoft.AspNetCore.Http;
using UmbracoVisualEditor.Markers;
using UmbracoVisualEditor.Rendering;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Strings;

namespace UmbracoVisualEditor.Tests.Markers;

public class MarkedPropertyTests
{
    private static readonly Guid Block = Guid.NewGuid();
    private static readonly Guid BlockType = Guid.NewGuid();

    /// <summary>A published property with only what these tests need: its alias, converted value and owner's type.</summary>
    private class FakeProperty : DispatchProxy
    {
        public object? Value { get; set; }

        /// <summary>The owner's content type key; null for a property type without a content type.</summary>
        public Guid? ContentTypeKey { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_Alias" => "items",
            "GetValue" => Value,
            "get_PropertyType" => PropertyType(),
            _ => throw new NotSupportedException(method?.Name),
        };

        private IPublishedPropertyType PropertyType()
        {
            var type = DispatchProxy.Create<IPublishedPropertyType, FakePropertyType>();
            ((FakePropertyType)(object)type).ContentTypeKey = ContentTypeKey;
            return type;
        }
    }

    /// <summary>An invariant rich text property type, for registering markers.</summary>
    private class FakePropertyType : DispatchProxy
    {
        public Guid? ContentTypeKey { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_Variations" => Umbraco.Cms.Core.Models.ContentVariation.Nothing,
            "get_EditorAlias" => Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.RichText,
            "get_ContentType" => ContentTypeKey is { } key ? ContentType(key) : null,
            _ => throw new NotSupportedException(method?.Name),
        };

        private static IPublishedContentType ContentType(Guid key)
        {
            var type = DispatchProxy.Create<IPublishedContentType, FakeContentType>();
            ((FakeContentType)(object)type).Key = key;
            return type;
        }
    }

    /// <summary>A published content type with only its key.</summary>
    private class FakeContentType : DispatchProxy
    {
        public Guid Key { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_Key" => Key,
            _ => throw new NotSupportedException(method?.Name),
        };
    }

    private sealed class Accessor : IVariationContextAccessor
    {
        public VariationContext? VariationContext { get; set; } = new("en-US");
    }

    /// <summary>A render session's request, as the model factory sees it while marking.</summary>
    private static HttpContext RenderSessionRequest()
    {
        var context = new DefaultHttpContext();
        EditModeRequest.Set(context, new EditModeRequest(new RenderSession(Guid.NewGuid(), Guid.NewGuid(), null, null, [], [], Guid.Empty)));
        return context;
    }

    private static (MarkedProperty Property, MarkerRegistry Registry, HttpContextAccessor Http) Marked(
        object? value,
        Guid? contentTypeKey = null)
    {
        var inner = DispatchProxy.Create<IPublishedProperty, FakeProperty>();
        ((FakeProperty)(object)inner).Value = value;
        ((FakeProperty)(object)inner).ContentTypeKey = contentTypeKey;
        var http = new HttpContextAccessor { HttpContext = RenderSessionRequest() };
        MarkerRegistry registry = EditModeRequest.Get(http.HttpContext)!.Markers;
        return (new MarkedProperty(inner, Block, ownerIsBlock: true, registry, new Accessor(), http), registry, http);
    }

    [Fact]
    public void RichText_IsMarked_InItsRenderSession()
    {
        (MarkedProperty property, _, _) = Marked(new HtmlEncodedString("<p>Hi</p>"));

        Assert.Equal("<!--uve:p:1--><p>Hi</p><!--/uve:p:1-->", property.GetValue()!.ToString());
    }

    [Fact]
    public void OtherRequests_GetThePlainValue()
    {
        // A marked block element can end up in Umbraco's shared published cache (a form in a rich text block loads
        // the published page while the rich text converts): live visitors, and later render sessions, must not see
        // markers from it.
        var html = new HtmlEncodedString("<p>Hi</p>");
        (MarkedProperty property, MarkerRegistry registry, HttpContextAccessor http) = Marked(html);

        http.HttpContext = new DefaultHttpContext();
        Assert.Same(html, property.GetValue());

        http.HttpContext = RenderSessionRequest();
        Assert.Same(html, property.GetValue());

        http.HttpContext = null;
        Assert.Same(html, property.GetValue());
        Assert.Empty(registry.All);
    }

    [Fact]
    public void AnEmptyBlockList_IsItsOwnEmptyValue_RememberedAsThisProperty()
    {
        // Umbraco's empty value is shared, so it couldn't tell one empty list from another (#97).
        (MarkedProperty property, MarkerRegistry registry, _) = Marked(BlockListModel.Empty, BlockType);

        var value = Assert.IsType<BlockListModel>(property.GetValue());

        Assert.NotSame(BlockListModel.Empty, value);
        Assert.Empty(value);
        // With the owner's type, for the property's name on the page's "Add block" button.
        Assert.Equal(new EmptyBlocksSpot(Block, true, "items", IsGrid: false, BlockType), registry.EmptyBlocksFor(value));
        Assert.Null(registry.EmptyBlocksFor(BlockListModel.Empty));
    }

    [Fact]
    public void AnEmptyBlockGrid_KeepsItsColumns()
    {
        (MarkedProperty property, MarkerRegistry registry, _) = Marked(new BlockGridModel([], 12));

        var value = Assert.IsType<BlockGridModel>(property.GetValue());

        Assert.Empty(value);
        Assert.Equal(12, value.GridColumns);
        // A property type without a content type: no key, so the button just says "Add block".
        Assert.Equal(new EmptyBlocksSpot(Block, true, "items", IsGrid: true), registry.EmptyBlocksFor(value));
    }

    [Fact]
    public void OtherValues_PassThroughUnremembered()
    {
        (MarkedProperty property, MarkerRegistry registry, _) = Marked(42);

        Assert.Equal(42, property.GetValue());
        Assert.Null(registry.EmptyBlocksFor(42));
        Assert.Null(registry.EmptyBlocksFor(null));
    }
}
