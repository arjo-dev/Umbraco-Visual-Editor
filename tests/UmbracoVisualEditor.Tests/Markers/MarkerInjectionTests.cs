using UmbracoVisualEditor.Markers;

namespace UmbracoVisualEditor.Tests.Markers;

public class MarkerInjectionTests
{
    private const string Page = "<html><head><link rel=\"stylesheet\" href=\"/site.css\"></head><body><h1>Hi</h1></body></html>";
    private const string Link = "<link rel=\"stylesheet\" href=\"/App_Plugins/ArjoVisualEditor/backoffice-render.css\">";
    private const string Script = "<script type=\"module\" src=\"/App_Plugins/ArjoVisualEditor/canvas-runtime.js\"></script>";

    [Fact]
    public void Inject_AddsTheManifestAndScriptBeforeTheBodyEnds()
    {
        var html = MarkerInjection(Page, withStylesheet: false);

        Assert.EndsWith(Script + "</body></html>", html);
        Assert.Contains("<script type=\"application/json\" id=\"uve-markers\">{\"markers\":[]}</script>", html);
        Assert.DoesNotContain("backoffice-render.css", html);
    }

    [Fact]
    public void Inject_LinksTheRenderStylesheetAfterTheTemplatesStyles()
    {
        var html = MarkerInjection(Page, withStylesheet: true);

        Assert.Contains("href=\"/site.css\">" + Link + "</head>", html);
        Assert.EndsWith(Script + "</body></html>", html);
    }

    [Fact]
    public void Inject_WithoutAHead_LinksTheStylesheetWithTheScripts()
    {
        var html = MarkerInjection("<p>Hi</p>", withStylesheet: true);

        Assert.StartsWith("<p>Hi</p>" + Link + "<script type=\"application/json\"", html);
        Assert.EndsWith(Script, html);
    }

    [Fact]
    public void Inject_EscapesTheManifestsClosingTags()
    {
        var html = MarkerInjectionMiddleware.Inject(Page, "{\"label\":\"</script>\"}", withStylesheet: false);

        Assert.Contains("{\"label\":\"<\\/script>\"}", html);
    }

    private static string MarkerInjection(string html, bool withStylesheet)
        => MarkerInjectionMiddleware.Inject(html, "{\"markers\":[]}", withStylesheet);
}
