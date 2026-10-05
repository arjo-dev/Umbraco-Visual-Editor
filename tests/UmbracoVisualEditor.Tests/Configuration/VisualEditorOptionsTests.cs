using UmbracoVisualEditor.Configuration;

namespace UmbracoVisualEditor.Tests.Configuration;

public class VisualEditorOptionsTests
{
    [Fact]
    public void ByDefault_EveryDocumentTypeIsEnabled()
        => Assert.True(new VisualEditorOptions().IsEnabledFor("home"));

    [Fact]
    public void ByDefault_PropertiesCanBeEditedOnThePage()
        => Assert.True(new VisualEditorOptions().EnablePropertyLevelEditing);

    [Fact]
    public void Disabled_TurnsItOffEverywhere()
        => Assert.False(new VisualEditorOptions { Enabled = false }.IsEnabledFor("home"));

    [Fact]
    public void AllowedDocumentTypes_LimitsIt_IgnoringCase()
    {
        var options = new VisualEditorOptions { AllowedDocumentTypes = ["contentPage", "home"] };
        Assert.True(options.IsEnabledFor("ContentPage"));
        Assert.False(options.IsEnabledFor("article"));
    }

    [Fact]
    public void ExcludedDocumentTypes_RuleThemOut()
    {
        var options = new VisualEditorOptions { ExcludedDocumentTypes = ["error"] };
        Assert.False(options.IsEnabledFor("error"));
        Assert.True(options.IsEnabledFor("home"));
    }

    [Fact]
    public void Validation_AcceptsTheDefaultsAndDistinctLists()
    {
        var validator = new VisualEditorOptionsValidator();
        Assert.True(validator.Validate(null, new VisualEditorOptions()).Succeeded);
        Assert.True(validator.Validate(null, new VisualEditorOptions
        {
            AllowedDocumentTypes = ["home"],
            ExcludedDocumentTypes = ["error"],
        }).Succeeded);
    }

    [Fact]
    public void Validation_RefusesEmptyAliasesAndAliasesInBothLists()
    {
        var validator = new VisualEditorOptionsValidator();
        Assert.True(validator.Validate(null, new VisualEditorOptions { AllowedDocumentTypes = [" "] }).Failed);
        var both = validator.Validate(null, new VisualEditorOptions
        {
            AllowedDocumentTypes = ["home"],
            ExcludedDocumentTypes = ["Home"],
        });
        Assert.True(both.Failed);
        Assert.Contains("home", both.FailureMessage, StringComparison.OrdinalIgnoreCase);
    }
}
