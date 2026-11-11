using UmbracoVisualEditor.Markers;

namespace UmbracoVisualEditor.Tests.Markers;

public class MarkerInjectionTests
{
    private const string Page = "<html><head><link rel=\"stylesheet\" href=\"/site.css\"></head><body><h1>Hi</h1></body></html>";
    private const string ScriptUrl = "/App_Plugins/ArjoVisualEditor/canvas-runtime.js?v=1";
    private const string StylesheetUrl = "/App_Plugins/ArjoVisualEditor/backoffice-render.css?v=2";
    private const string Link = "<link rel=\"stylesheet\" href=\"" + StylesheetUrl + "\">";
    private const string Script = "<script type=\"module\" src=\"" + ScriptUrl + "\"></script>";

    [Fact]
    public void Inject_AddsTheManifestAndScriptBeforeTheBodyEnds()
    {
        var html = MarkerInjection(Page, stylesheetUrl: null);

        Assert.EndsWith(Script + "</body></html>", html);
        Assert.Contains("<script type=\"application/json\" id=\"uve-markers\">{\"markers\":[]}</script>", html);
        Assert.DoesNotContain("backoffice-render.css", html);
    }

    [Fact]
    public void Inject_LinksTheRenderStylesheetAfterTheTemplatesStyles()
    {
        var html = MarkerInjection(Page, StylesheetUrl);

        Assert.Contains("href=\"/site.css\">" + Link + "</head>", html);
        Assert.EndsWith(Script + "</body></html>", html);
    }

    [Fact]
    public void Inject_WithoutAHead_LinksTheStylesheetWithTheScripts()
    {
        var html = MarkerInjection("<p>Hi</p>", StylesheetUrl);

        Assert.StartsWith("<p>Hi</p>" + Link + "<script type=\"application/json\"", html);
        Assert.EndsWith(Script, html);
    }

    [Fact]
    public void Inject_LoadsTheSitesRenderScriptBeforeTheCanvas()
    {
        const string siteScript = "/App_Plugins/ArjoVisualEditor/backoffice-render.js?v=3";
        var html = MarkerInjectionMiddleware.Inject(Page, "{}", ScriptUrl, null, siteScript);

        Assert.EndsWith($"</script><script defer src=\"{siteScript}\"></script>{Script}</body></html>", html);
    }

    [Fact]
    public void Inject_EscapesTheManifestsClosingTags()
    {
        var html = MarkerInjectionMiddleware.Inject(Page, "{\"label\":\"</script>\"}", ScriptUrl, null);

        Assert.Contains("{\"label\":\"<\\/script>\"}", html);
    }

    [Fact]
    public void Inject_AddsTheEditingClassToTheHtmlElement()
    {
        var html = MarkerInjection(Page, stylesheetUrl: null);

        Assert.StartsWith("<html class=\"uve-editing\"><head>", html);
    }

    [Theory]
    [InlineData("<!DOCTYPE html><html lang=\"en\">", "<!DOCTYPE html><html lang=\"en\" class=\"uve-editing\">")]
    [InlineData("<html class=\"no-js dark\" lang=\"en\">", "<html class=\"no-js dark uve-editing\" lang=\"en\">")]
    [InlineData("<HTML CLASS='a'>", "<HTML class=\"a uve-editing\">")]
    [InlineData("<html class=a>", "<html class=\"a uve-editing\">")]
    [InlineData("<html class=\"\">", "<html class=\"uve-editing\">")]
    [InlineData("<html data-class=\"x\">", "<html data-class=\"x\" class=\"uve-editing\">")]
    [InlineData("<html\n  lang=\"en\"\n>", "<html\n  lang=\"en\"\n class=\"uve-editing\">")]
    public void AddHtmlClass_KeepsTheElementsOwnAttributes(string page, string expected)
        => Assert.Equal(expected + "<body></body></html>", MarkerInjectionMiddleware.AddHtmlClass(page + "<body></body></html>"));

    [Theory]
    [InlineData("<html class=\"uve-editing\"><body></body></html>")]
    [InlineData("<p>No html element</p>")]
    [InlineData("<html-widget></html-widget>")]
    public void AddHtmlClass_LeavesPagesWithoutAnHtmlTagOrWithTheClassAlone(string page)
        => Assert.Equal(page, MarkerInjectionMiddleware.AddHtmlClass(page));

    [Fact]
    public void AddHtmlClass_OnlyChangesTheFirstHtmlTag()
    {
        const string page = "<html><body><pre>&lt;html&gt;</pre><template><html></html></template></body></html>";

        Assert.Equal(
            "<html class=\"uve-editing\"><body><pre>&lt;html&gt;</pre><template><html></html></template></body></html>",
            MarkerInjectionMiddleware.AddHtmlClass(page));
    }

    private static string MarkerInjection(string html, string? stylesheetUrl)
        => MarkerInjectionMiddleware.Inject(html, "{\"markers\":[]}", ScriptUrl, stylesheetUrl);
}
