using Arjo.VisualEditor.Markers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Web.Common.ApplicationBuilder;

namespace Arjo.VisualEditor.Composers;

/// <summary>Edit-mode markers (spike #10, docs/adr/0002-dom-markers.md).</summary>
public class MarkersComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddTransient<IPostConfigureOptions<MvcViewOptions>, BlockMarkingViewOptionsSetup>();
        builder.Services.Configure<UmbracoPipelineOptions>(options =>
            options.AddFilter(new UmbracoPipelineFilter("Arjo.VisualEditor.Markers")
            {
                PrePipeline = app => app.UseMiddleware<MarkerInjectionMiddleware>(),
            }));

        DecorateModelFactory(builder.Services);
    }

    // Wrap whichever IPublishedModelFactory is registered (ModelsBuilder's, or InMemoryAuto's in development).
    private static void DecorateModelFactory(IServiceCollection services)
    {
        ServiceDescriptor? existing = services.LastOrDefault(d => d.ServiceType == typeof(IPublishedModelFactory));
        if (existing is null)
        {
            return;
        }

        services.Remove(existing);
        services.Add(new ServiceDescriptor(
            typeof(IPublishedModelFactory),
            sp => new MarkingPublishedModelFactory(
                CreateInner(sp, existing),
                sp.GetRequiredService<IHttpContextAccessor>(),
                sp.GetRequiredService<IVariationContextAccessor>()),
            existing.Lifetime));
    }

    private static IPublishedModelFactory CreateInner(IServiceProvider sp, ServiceDescriptor descriptor)
        => (IPublishedModelFactory)(descriptor.ImplementationInstance
            ?? descriptor.ImplementationFactory?.Invoke(sp)
            ?? ActivatorUtilities.CreateInstance(sp, descriptor.ImplementationType!));
}
