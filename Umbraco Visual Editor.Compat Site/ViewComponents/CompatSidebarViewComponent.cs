using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Web.Common.PublishedModels;

namespace Umbraco_Visual_Editor.Compat_Site.ViewComponents;

/// <summary>A view component rendering a property (#38): its view gets the value through the page's model.</summary>
public class CompatSidebarViewComponent : ViewComponent
{
    public IViewComponentResult Invoke(CompatPage page) => View(page);
}
