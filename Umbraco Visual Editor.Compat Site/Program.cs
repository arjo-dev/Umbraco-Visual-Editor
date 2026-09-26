using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Web.Common.ApplicationBuilder;
using Umbraco_Visual_Editor.Compat_Site.Composers;

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

// Output caching for every page (#38), as a site might switch it on: the Visual editor must not be served cached
// render sessions, and must still render the latest unsaved values.
builder.Services.AddOutputCache(options => options.AddBasePolicy(policy => policy.Expire(TimeSpan.FromMinutes(10))));
builder.Services.Configure<UmbracoPipelineOptions>(options => options.AddFilter(new UmbracoPipelineFilter("Compat.OutputCache")
{
    PostRouting = app => app.UseOutputCache(),
}));

// Readiness for the E2E tests: 503 until the compatibility page exists and is published (it's created on first boot,
// after the site has started; Umbraco's "no published content" page would answer 200 before then).
builder.Services.Configure<UmbracoPipelineOptions>(options => options.AddFilter(new UmbracoPipelineFilter("Compat.Ready")
{
    PrePipeline = app => app.Map("/compat-ready", ready => ready.Run(async context =>
    {
        var content = context.RequestServices.GetRequiredService<IContentService>().GetById(CreateCompatContent.PageKey);
        context.Response.StatusCode = content?.Published == true ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsync(content?.Published == true ? "ready" : "starting");
    })),
}));

builder.CreateUmbracoBuilder()
    .AddBackOffice()
    .AddWebsite()
    .AddComposers()
    .Build();

WebApplication app = builder.Build();

await app.BootUmbracoAsync();

app.UseUmbraco()
    .WithMiddleware(u =>
    {
        u.UseBackOffice();
        u.UseWebsite();
    })
    .WithEndpoints(u =>
    {
        u.UseBackOfficeEndpoints();
        u.UseWebsiteEndpoints();
    });

await app.RunAsync();
