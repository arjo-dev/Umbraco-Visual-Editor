using UmbracoVisualEditor.Markers;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Cache;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Web.Common.ApplicationBuilder;

namespace UmbracoVisualEditor.Composers;

/// <summary>Edit-mode markers (spike #10, docs/adr/0002-dom-markers.md).</summary>
public class MarkersComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddTransient<IPostConfigureOptions<MvcViewOptions>, BlockMarkingViewOptionsSetup>();
        builder.Services.Configure<UmbracoPipelineOptions>(options =>
            options.AddFilter(new UmbracoPipelineFilter("UmbracoVisualEditor.Markers")
            {
                PrePipeline = app => app.UseMiddleware<MarkerInjectionMiddleware>(),
            }));

        // Not now: when the Umbraco builder is built, after every composer (see LateDecorations).
        builder.WithCollectionBuilder<LateDecorations>();
    }

    /// <summary>
    /// Wraps the site's <see cref="IPublishedModelFactory"/> for marking, and its <see cref="AppCaches"/>. Each has to
    /// wrap the last one registered, but
    /// other composers register theirs too (Umbraco's backoffice development mode registers InMemoryAuto's, a
    /// community ModelsBuilder its own), in no set order relative to ours: when one ran after us it replaced the
    /// decorator, and text and rich text lost their markers (seen on Linux CI, #37). Umbraco registers collection
    /// builders in <c>IUmbracoBuilder.Build()</c>, after all composers, so this decorates whichever registration won.
    /// </summary>
    private sealed class LateDecorations : ICollectionBuilder
    {
        public void RegisterWith(IServiceCollection services)
        {
            DecorateModelFactory(services);
            DecorateAppCaches(services);
        }
    }

    // Render sessions must never read or fill the shared partial view cache (see EditModeRuntimeCache).
    private static void DecorateAppCaches(IServiceCollection services)
    {
        ServiceDescriptor? existing = services.LastOrDefault(d => d.ServiceType == typeof(AppCaches));
        if (existing is null)
        {
            return;
        }

        services.Remove(existing);
        services.Add(new ServiceDescriptor(
            typeof(AppCaches),
            sp =>
            {
                var inner = (AppCaches)(existing.ImplementationInstance
                    ?? existing.ImplementationFactory?.Invoke(sp)
                    ?? ActivatorUtilities.CreateInstance(sp, existing.ImplementationType!));
                return new AppCaches(
                    new EditModeRuntimeCache(inner.RuntimeCache, sp.GetRequiredService<IHttpContextAccessor>()),
                    inner.RequestCache,
                    inner.IsolatedCaches);
            },
            existing.Lifetime));
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
