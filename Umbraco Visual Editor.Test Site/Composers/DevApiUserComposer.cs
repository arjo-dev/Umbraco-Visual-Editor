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
    IHostApplicationLifetime lifetime,
    IRuntimeState runtimeState,
    IServiceScopeFactory scopeFactory,
    Microsoft.Extensions.Options.IOptions<DevApiUserOptions> options,
    ILogger<EnsureDevApiUserHandler> logger)
    : INotificationAsyncHandler<UmbracoApplicationStartedNotification>
{
    private static readonly TimeSpan Timeout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(2);

    public Task HandleAsync(UmbracoApplicationStartedNotification notification, CancellationToken cancellationToken)
    {
        if (!hostEnvironment.IsDevelopment() || string.IsNullOrWhiteSpace(options.Value.ClientSecret))
        {
            return Task.CompletedTask;
        }

        // With Hosting:Debug=false, Umbraco runs unattended package migrations (Clean, uSync first boot) in a background
        // service *after* the app has started, so the runtime may not be ready yet. Wait for it off the startup path.
        _ = Task.Run(() => EnsureWhenRunningAsync(lifetime.ApplicationStopping), CancellationToken.None);
        return Task.CompletedTask;
    }

    private async Task EnsureWhenRunningAsync(CancellationToken stopping)
    {
        DateTime deadline = DateTime.UtcNow + Timeout;
        Exception? lastError = null;
        while (!stopping.IsCancellationRequested && DateTime.UtcNow < deadline)
        {
            if (runtimeState.Level == RuntimeLevel.Run)
            {
                try
                {
                    // A fresh scope per attempt: this runs after the notification's own scope has been disposed.
                    using IServiceScope scope = scopeFactory.CreateScope();
                    await EnsureAsync(
                        scope.ServiceProvider.GetRequiredService<IUserService>(),
                        scope.ServiceProvider.GetRequiredService<IBackOfficeUserClientCredentialsManager>());
                    return;
                }
                catch (Exception ex)
                {
                    // e.g. the database is busy with the background migrations; try again shortly.
                    lastError = ex;
                    logger.LogDebug(ex, "Dev API user not created yet, retrying");
                }
            }

            try
            {
                await Task.Delay(RetryDelay, stopping);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }

        if (!stopping.IsCancellationRequested)
        {
            logger.LogWarning(lastError, "Gave up creating the dev API user after {Timeout}", Timeout);
        }
    }

    private async Task EnsureAsync(IUserService userService, IBackOfficeUserClientCredentialsManager clientCredentialsManager)
    {
        DevApiUserOptions settings = options.Value;
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

        var saved = await clientCredentialsManager.SaveAsync(user.Key, settings.ClientId, settings.ClientSecret!);
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
