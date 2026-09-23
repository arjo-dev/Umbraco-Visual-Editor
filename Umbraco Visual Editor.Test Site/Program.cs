
WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

#if DEBUG
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);
#endif

// Fresh install: Clean's package migration seeds content before uSync's first-boot import runs, and uSync's
// export-on-save would overwrite the committed uSync files with Clean's defaults before they're imported.
// Switch export-on-save off for this first boot only.
if (!File.Exists(Path.Combine(builder.Environment.ContentRootPath, "umbraco", "Data", "Umbraco.sqlite.db")))
{
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["uSync:Settings:ExportOnSave"] = "None" });
}

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
