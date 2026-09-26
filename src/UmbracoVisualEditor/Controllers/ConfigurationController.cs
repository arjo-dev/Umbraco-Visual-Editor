using UmbracoVisualEditor.Configuration;
using Asp.Versioning;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace UmbracoVisualEditor.Controllers;

/// <param name="Enabled">Whether the Visual editor is offered at all.</param>
/// <param name="AllowedDocumentTypes">Document type aliases to offer it for; empty means all.</param>
/// <param name="ExcludedDocumentTypes">Document type aliases never to offer it for.</param>
public sealed record VisualEditorConfigurationResponseModel(
    bool Enabled,
    IReadOnlyList<string> AllowedDocumentTypes,
    IReadOnlyList<string> ExcludedDocumentTypes);

/// <summary>The Visual editor's settings (#32), for the backoffice to decide where to offer it.</summary>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "UmbracoVisualEditor")]
public sealed class ConfigurationController(IOptionsMonitor<VisualEditorOptions> options) : VisualEditorApiControllerBase
{
    [HttpGet("configuration")]
    [ProducesResponseType<VisualEditorConfigurationResponseModel>(StatusCodes.Status200OK)]
    public IActionResult Get()
    {
        VisualEditorOptions current = options.CurrentValue;
        return Ok(new VisualEditorConfigurationResponseModel(
            current.Enabled,
            current.AllowedDocumentTypes,
            current.ExcludedDocumentTypes));
    }
}
