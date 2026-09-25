using System.Text.Json;
using Arjo.VisualEditor.Configuration;
using Arjo.VisualEditor.Rendering;
using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Actions;
using Umbraco.Cms.Core.PublishedCache;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Security.Authorization;
using Umbraco.Cms.Web.Common.Authorization;
using Umbraco.Extensions;

namespace Arjo.VisualEditor.Controllers;

/// <param name="DocumentKey">The document to render. It must have been saved at least once.</param>
/// <param name="Culture">Culture to render; null for invariant documents.</param>
/// <param name="Segment">Segment to render, if any.</param>
/// <param name="Values">The workspace's current property values, in the same format the Management API accepts.</param>
/// <param name="Variants">The workspace's current variant names (so unsaved renames show). Optional.</param>
public sealed record RenderSessionRequestModel(
    Guid DocumentKey,
    string? Culture,
    string? Segment,
    IReadOnlyList<RenderValueModel> Values,
    IReadOnlyList<RenderVariantModel>? Variants = null);

public sealed record RenderValueModel(string Alias, string? Culture, string? Segment, JsonElement Value);

public sealed record RenderVariantModel(string? Culture, string? Segment, string Name);

/// <param name="Token">The session token (valid for 10 minutes after last use).</param>
/// <param name="Url">Relative front-end URL that renders the document with the session's values.</param>
public sealed record RenderSessionResponseModel(Guid Token, string Url);

/// <summary>
/// Creates a render session from unsaved workspace values; the returned URL renders the page with them through the
/// site's normal front-end pipeline, with edit-mode markers. See docs/adr/0001-render-unsaved-values.md and 0002.
/// </summary>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "Arjo.VisualEditor")]
public sealed class RenderSessionController(
    RenderSessionStore sessions,
    IAuthorizationService authorizationService,
    IPublishedContentCache contentCache,
    IBackOfficeSecurityAccessor backOfficeSecurityAccessor,
    IOptionsMonitor<VisualEditorOptions> options) : ArjoVisualEditorApiControllerBase
{
    [HttpPost("render-session")]
    [ProducesResponseType<RenderSessionResponseModel>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Create(RenderSessionRequestModel model)
    {
        AuthorizationResult authorized = await authorizationService.AuthorizeResourceAsync(
            User,
            ContentPermissionResource.WithKeys(ActionBrowse.ActionLetter, model.DocumentKey),
            AuthorizationPolicies.ContentPermissionByResource);
        if (!authorized.Succeeded)
        {
            return Forbid();
        }

        // Rendering overlays the document's draft, so it must have been saved at least once.
        IPublishedContent? draft = await contentCache.GetByIdAsync(model.DocumentKey, preview: true);
        if (draft is null)
        {
            return NotFound();
        }

        // The settings may rule this document type out (#32); the backoffice doesn't offer the Visual editor then.
        if (!options.CurrentValue.IsEnabledFor(draft.ContentType.Alias))
        {
            return Problem(
                statusCode: StatusCodes.Status403Forbidden,
                title: "The visual editor isn't enabled for this document type.");
        }

        // Unsaved values are only rendered for users who could save them (#34). Anyone else sees the document as
        // saved: they can't change it (the Visual editor is read-only for them, #31), and values they made up could
        // otherwise show them content they may not see, e.g. a picker pointing outside their start nodes.
        AuthorizationResult mayUpdate = await authorizationService.AuthorizeResourceAsync(
            User,
            ContentPermissionResource.WithKeys(ActionUpdate.ActionLetter, model.DocumentKey),
            AuthorizationPolicies.ContentPermissionByResource);
        IEnumerable<RenderValue> values = mayUpdate.Succeeded
            ? model.Values.Select(v => new RenderValue(v.Alias, v.Culture, v.Segment, v.Value))
            : [];
        IEnumerable<RenderVariantName> variants = mayUpdate.Succeeded
            ? (model.Variants ?? []).Select(v => new RenderVariantName(v.Culture, v.Segment, v.Name))
            : [];

        // Only this user may render the session: this browser gets a pass for it (RenderViewerCookie).
        var userKey = backOfficeSecurityAccessor.BackOfficeSecurity?.CurrentUser?.Key
                      ?? User.GetUmbracoIdentity()?.GetUserKey()
                      ?? Guid.Empty;
        if (userKey == Guid.Empty)
        {
            return Forbid();
        }

        await RenderViewerCookie.IssueAsync(HttpContext, sessions, userKey);
        RenderSession session = await sessions.CreateAsync(
            model.DocumentKey,
            model.Culture,
            model.Segment,
            values,
            variants,
            userKey,
            HttpContext.RequestAborted);

        return Ok(new RenderSessionResponseModel(session.Token, $"{RenderSessionContentFinder.PathPrefix}{session.Token:N}"));
    }
}
