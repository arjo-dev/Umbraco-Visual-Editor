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
using Umbraco.Cms.Core.Models.Blocks;
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

    private static IHtmlHelper<object> Html(bool editMode, bool autoMark = true)
    {
        var services = new ServiceCollection();
        services.Configure<VisualEditorOptions>(options => options.AutoMarkEmptyBlocks = autoMark);
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
    private static T Empty<T>(IHtmlHelper html, T value, bool isGrid) where T : class
    {
        EditModeRequest.Get(html.ViewContext.HttpContext)?.Markers
            .RegisterEmptyBlocks(value, new EmptyBlocksSpot(Page, false, "items", isGrid));
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
}
