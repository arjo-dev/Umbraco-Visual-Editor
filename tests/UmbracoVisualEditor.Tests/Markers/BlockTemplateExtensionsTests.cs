using System.Net;
using System.Reflection;
using System.Text.Encodings.Web;
using UmbracoVisualEditor.Configuration;
using UmbracoVisualEditor.Markers;
using UmbracoVisualEditor.Rendering;
using Microsoft.AspNetCore.Html;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Services;
// Both, as in a view that imports the package's namespace (#97): calls must bind to ours, and not be ambiguous.
using Umbraco.Extensions;
using UmbracoVisualEditor.Extensions;

namespace UmbracoVisualEditor.Tests.Markers;

public class BlockTemplateExtensionsTests
{
    private static readonly Guid Page = Guid.NewGuid();

    /// <summary>A view's <c>Html</c>, with only its view context: Umbraco's helpers don't use it for an empty value.</summary>
    private class FakeHtmlHelper : DispatchProxy
    {
        public ViewContext ViewContext { get; set; } = null!;

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_ViewContext" => ViewContext,
            _ => throw new NotSupportedException(method?.Name),
        };
    }

    /// <summary>
    /// A content type service that only knows <see cref="PageType"/>, with an "items" property named "Page items"; or
    /// one that throws on every call.
    /// </summary>
    private class FakeContentTypeService : DispatchProxy
    {
        public bool Throws { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (Throws)
            {
                throw new InvalidOperationException("The database is down.");
            }

            return method?.Name == "Get" && args is [Guid key]
                ? key == PageType ? Fake<IContentType>(("get_CompositionPropertyTypes", new[] { ItemsProperty() })) : null
                : throw new NotSupportedException(method?.Name);
        }

        private static IPropertyType ItemsProperty()
            => Fake<IPropertyType>(("get_Alias", "items"), ("get_Name", "Page items"));
    }

    /// <summary>An interface implementation that answers the given getters and nothing else.</summary>
    private class FakeGetters : DispatchProxy
    {
        public Dictionary<string, object?> Values { get; } = [];

        protected override object? Invoke(MethodInfo? method, object?[]? args)
            => method is not null && Values.TryGetValue(method.Name, out var value)
                ? value
                : throw new NotSupportedException(method?.Name);
    }

    private static T Fake<T>(params (string Getter, object? Value)[] values) where T : class
    {
        T fake = DispatchProxy.Create<T, FakeGetters>();
        foreach ((string getter, object? value) in values)
        {
            ((FakeGetters)(object)fake).Values[getter] = value;
        }

        return fake;
    }

    private static readonly Guid PageType = Guid.NewGuid();

    private static IHtmlHelper<object> Html(bool editMode, bool autoMark = true, IContentTypeService? contentTypes = null)
    {
        var services = new ServiceCollection();
        services.Configure<VisualEditorOptions>(options => options.AutoMarkEmptyBlocks = autoMark);
        if (contentTypes is not null)
        {
            services.AddSingleton(contentTypes);
        }

        var context = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        if (editMode)
        {
            EditModeRequest.Set(context, new EditModeRequest(new RenderSession(Guid.NewGuid(), Page, null, null, [], [], Guid.Empty)));
        }

        var html = DispatchProxy.Create<IHtmlHelper<object>, FakeHtmlHelper>();
        ((FakeHtmlHelper)(object)html).ViewContext = new ViewContext { HttpContext = context };
        return html;
    }

    /// <summary>An empty value, remembered as the page's property as <see cref="MarkedProperty"/> would.</summary>
    private static T Empty<T>(IHtmlHelper html, T value, bool isGrid, Guid? contentTypeKey = null) where T : class
    {
        EditModeRequest.Get(html.ViewContext.HttpContext)?.Markers
            .RegisterEmptyBlocks(value, new EmptyBlocksSpot(Page, false, "items", isGrid, contentTypeKey));
        return value;
    }

    private static string Text(IHtmlContent content)
    {
        using var writer = new StringWriter();
        content.WriteTo(writer, HtmlEncoder.Default);
        return writer.ToString();
    }

    [Fact]
    public void AnEmptyBlockList_IsMarkedInTheVisualEditor()
    {
        IHtmlHelper<object> html = Html(editMode: true);

        var output = Text(html.GetBlockListHtml(Empty(html, new BlockListModel([]), isGrid: false)));

        Assert.Contains("data-uve-empty-blocks", output);
        Assert.Contains("Umbraco.BlockList", WebUtility.HtmlDecode(output));
        Assert.Contains(Page.ToString(), WebUtility.HtmlDecode(output));
    }

    [Fact]
    public async Task AnEmptyBlockGrid_IsMarkedInTheVisualEditor()
    {
        IHtmlHelper<object> html = Html(editMode: true);

        var output = Text(await html.GetBlockGridHtmlAsync(Empty(html, new BlockGridModel([], 12), isGrid: true)));

        Assert.Contains("Umbraco.BlockGrid", WebUtility.HtmlDecode(output));
    }

    [Fact]
    public void TheMark_HasThePropertysName_ForItsAddBlockButton()
    {
        var contentTypes = DispatchProxy.Create<IContentTypeService, FakeContentTypeService>();
        IHtmlHelper<object> html = Html(editMode: true, contentTypes: contentTypes);

        var output = Text(html.GetBlockListHtml(Empty(html, new BlockListModel([]), isGrid: false, PageType)));

        Assert.Contains("\"label\":\"Page items\"", WebUtility.HtmlDecode(output));
    }

    [Theory]
    [InlineData("no service")]
    [InlineData("no key")]
    [InlineData("unknown type")]
    [InlineData("service throws")]
    public void TheMark_HasNoName_WhenItCantBeFound_AndStillRenders(string reason)
    {
        var contentTypes = DispatchProxy.Create<IContentTypeService, FakeContentTypeService>();
        ((FakeContentTypeService)(object)contentTypes).Throws = reason == "service throws";
        IHtmlHelper<object> html = Html(editMode: true, contentTypes: reason == "no service" ? null : contentTypes);
        Guid? key = reason switch
        {
            "no key" => null,
            "unknown type" => Guid.NewGuid(),
            _ => PageType,
        };

        var output = WebUtility.HtmlDecode(Text(html.GetBlockListHtml(Empty(html, new BlockListModel([]), isGrid: false, key))));

        Assert.Contains("data-uve-empty-blocks", output);
        Assert.Contains("\"label\":null", output);
    }

    [Fact]
    public void NothingIsAdded_OnTheLiveSite()
    {
        IHtmlHelper<object> html = Html(editMode: false);

        Assert.Equal(string.Empty, Text(html.GetBlockListHtml(new BlockListModel([]))));
    }

    [Fact]
    public void NothingIsAdded_WhenTurnedOff()
    {
        IHtmlHelper<object> html = Html(editMode: true, autoMark: false);

        Assert.Equal(string.Empty, Text(html.GetBlockListHtml(Empty(html, new BlockListModel([]), isGrid: false))));
    }

    [Fact]
    public void AValueThatIsntTheDocuments_IsntMarked()
    {
        // e.g. Umbraco's shared empty value, or another page's list rendered here: never remembered.
        IHtmlHelper<object> html = Html(editMode: true);

        Assert.Equal(string.Empty, Text(html.GetBlockListHtml(BlockListModel.Empty)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void IsVisualEditor_IsTrueOnlyInARenderSession(bool editMode)
    {
        IHtmlHelper<object> html = Html(editMode);

        Assert.Equal(editMode, html.IsVisualEditor());
        Assert.Equal(editMode, html.ViewContext.HttpContext.IsVisualEditor());
    }

    [Fact]
    public void IsVisualEditor_IsFalseWithoutARequest()
        => Assert.False(((HttpContext?)null).IsVisualEditor());
}
