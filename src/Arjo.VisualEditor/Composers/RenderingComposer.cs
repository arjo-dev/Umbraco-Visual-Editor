using Arjo.VisualEditor.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

namespace Arjo.VisualEditor.Composers;

public class RenderingComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddMemoryCache();
        builder.Services.AddSingleton<RenderSessionStore>();
        builder.Services.AddSingleton<OverlayContentBuilder>();

        // First, so render URLs never fall through to normal URL routing.
        builder.ContentFinders().Insert<RenderSessionContentFinder>();
    }
}
