using System.Reflection;
using UmbracoVisualEditor.Rendering;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace UmbracoVisualEditor.Tests.Rendering;

public class OverlayPublishedPropertyTests
{
    /// <summary>A published property type with only what source values need: its alias and variations.</summary>
    private class FakePropertyType : DispatchProxy
    {
        public ContentVariation Variations { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_Variations" => Variations,
            "get_Alias" => "title",
            _ => throw new NotSupportedException(method?.Name),
        };
    }

    private sealed class Accessor : IVariationContextAccessor
    {
        public VariationContext? VariationContext { get; set; } = new("en-US");
    }

    private static OverlayPublishedProperty Property(ContentVariation variations, string? editedSegment)
    {
        var type = DispatchProxy.Create<IPublishedPropertyType, FakePropertyType>();
        ((FakePropertyType)(object)type).Variations = variations;
        var sources = new Dictionary<(string Culture, string Segment), object?>
        {
            [("en-US", string.Empty)] = "Default",
            [("en-US", "members")] = "For members",
        };
        return new OverlayPublishedProperty(type, null!, null, new Accessor(), sources, editedSegment);
    }

    [Fact]
    public void SegmentVariantProperties_ShowTheSegmentBeingEdited()
    {
        OverlayPublishedProperty property = Property(ContentVariation.CultureAndSegment, "members");
        Assert.Equal("For members", property.GetSourceValue());
    }

    [Fact]
    public void ASegmentWithoutItsOwnValue_FallsBackToTheDefault()
    {
        OverlayPublishedProperty property = Property(ContentVariation.CultureAndSegment, "visitors");
        Assert.Equal("Default", property.GetSourceValue());
    }

    [Fact]
    public void WithoutASegment_TheDefaultIsShown()
    {
        Assert.Equal("Default", Property(ContentVariation.CultureAndSegment, null).GetSourceValue());
        Assert.Equal("Default", Property(ContentVariation.Culture, "members").GetSourceValue());
    }
}
