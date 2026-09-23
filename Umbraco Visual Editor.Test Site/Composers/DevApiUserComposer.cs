using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Core.Services;

namespace Umbraco_Visual_Editor.Test_Site.Composers;

/// <summary>
/// Development only: ensures an API user with client credentials exists for the Umbraco MCP server
/// (and any other Management API tooling), so a fresh clone needs no manual backoffice setup.
/// Configured via <c>TestSite:ApiUser</c>; does nothing unless a client secret is set (user secrets / env var).
/// </summary>
public class DevApiUserComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        builder.Services.Configure<DevApiUserOptions>(builder.Config.GetSection(DevApiUserOptions.Section));
        builder.AddNotificationAsyncHandler<UmbracoApplicationStartedNotification, EnsureDevApiUserHandler>();
    }
}

public class DevApiUserOptions
{
    public const string Section = "TestSite:ApiUser";

    public string Name { get; set; } = "MCP";

    public string Email { get; set; } = "mcp@example.com";

    public string ClientId { get; set; } = "umbraco-back-office-mcp";

    public string? ClientSecret { get; set; }
}

public class EnsureDevApiUserHandler(
    IHostEnvironment hostEnvironment,
    IRuntimeState runtimeState,
    Microsoft.Extensions.Options.IOptions<DevApiUserOptions> options,
    IUserService userService,
    IBackOfficeUserClientCredentialsManager clientCredentialsManager,
    ILogger<EnsureDevApiUserHandler> logger)
    : INotificationAsyncHandler<UmbracoApplicationStartedNotification>
{
    public async Task HandleAsync(UmbracoApplicationStartedNotification notification, CancellationToken cancellationToken)
    {
        DevApiUserOptions settings = options.Value;
        if (!hostEnvironment.IsDevelopment()
            || runtimeState.Level != RuntimeLevel.Run
            || string.IsNullOrWhiteSpace(settings.ClientSecret))
        {
            return;
        }

        if (await clientCredentialsManager.FindUserAsync(settings.ClientId) is not null)
        {
            return;
        }

        IUser? user = userService.GetByEmail(settings.Email);
        if (user is null)
        {
            var create = new UserCreateModel
            {
                Email = settings.Email,
                UserName = settings.Email,
                Name = settings.Name,
                Kind = UserKind.Api,
                UserGroupKeys = new HashSet<Guid> { Constants.Security.AdminGroupKey },
            };

            var created = await userService.CreateAsync(Constants.Security.SuperUserKey, create, approveUser: true);
            user = created.Result.CreatedUser;
            if (!created.Success || user is null)
            {
                logger.LogWarning("Could not create dev API user {Email}: {Status}", settings.Email, created.Status);
                return;
            }
        }

        var saved = await clientCredentialsManager.SaveAsync(user.Key, settings.ClientId, settings.ClientSecret);
        if (saved.Success)
        {
            logger.LogInformation("Created dev API user {Email} with client id {ClientId}", settings.Email, settings.ClientId);
        }
        else
        {
            logger.LogWarning("Could not add client credentials {ClientId} to {Email}: {Status}", settings.ClientId, settings.Email, saved.Result);
        }
    }
}
