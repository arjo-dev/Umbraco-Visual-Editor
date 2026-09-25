using Arjo.VisualEditor.Configuration;
using Arjo.VisualEditor.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

namespace Arjo.VisualEditor.Composers;

public class RenderingComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        // The VisualEditor settings (#32), checked at startup.
        builder.Services.AddOptions<VisualEditorOptions>()
            .Bind(builder.Config.GetSection(VisualEditorOptions.SectionName))
            .ValidateOnStart();
        builder.Services.AddSingleton<IValidateOptions<VisualEditorOptions>, VisualEditorOptionsValidator>();

        // Default in-memory store; a site that registers its own IDistributedCache (Redis, SQL Server, ...) gets
        // load-balanced render sessions for free.
        builder.Services.AddDistributedMemoryCache();
        builder.Services.AddSingleton<RenderSessionStore>();
        builder.Services.AddSingleton<OverlayContentBuilder>();

        // First, so render URLs never fall through to normal URL routing.
        builder.ContentFinders().Insert<RenderSessionContentFinder>();
    }
}
