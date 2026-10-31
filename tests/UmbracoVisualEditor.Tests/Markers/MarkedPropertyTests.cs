using System.Reflection;
using UmbracoVisualEditor.Markers;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace UmbracoVisualEditor.Tests.Markers;

public class MarkedPropertyTests
{
    private static readonly Guid Block = Guid.NewGuid();

    /// <summary>A published property with only what these tests need: its alias and converted value.</summary>
    private class FakeProperty : DispatchProxy
    {
        public object? Value { get; set; }

        protected override object? Invoke(MethodInfo? method, object?[]? args) => method?.Name switch
        {
            "get_Alias" => "items",
            "GetValue" => Value,
            _ => throw new NotSupportedException(method?.Name),
        };
    }

    private sealed class Accessor : IVariationContextAccessor
    {
        public VariationContext? VariationContext { get; set; } = new("en-US");
    }

    private static (MarkedProperty Property, MarkerRegistry Registry) Marked(object? value)
    {
        var inner = DispatchProxy.Create<IPublishedProperty, FakeProperty>();
        ((FakeProperty)(object)inner).Value = value;
        var registry = new MarkerRegistry();
        return (new MarkedProperty(inner, Block, ownerIsBlock: true, registry, new Accessor()), registry);
    }

    [Fact]
    public void AnEmptyBlockList_IsItsOwnEmptyValue_RememberedAsThisProperty()
    {
        // Umbraco's empty value is shared, so it couldn't tell one empty list from another (#97).
        (MarkedProperty property, MarkerRegistry registry) = Marked(BlockListModel.Empty);

        var value = Assert.IsType<BlockListModel>(property.GetValue());

        Assert.NotSame(BlockListModel.Empty, value);
        Assert.Empty(value);
        Assert.Equal(new EmptyBlocksSpot(Block, true, "items", IsGrid: false), registry.EmptyBlocksFor(value));
        Assert.Null(registry.EmptyBlocksFor(BlockListModel.Empty));
    }

    [Fact]
    public void AnEmptyBlockGrid_KeepsItsColumns()
    {
        (MarkedProperty property, MarkerRegistry registry) = Marked(new BlockGridModel([], 12));

        var value = Assert.IsType<BlockGridModel>(property.GetValue());

        Assert.Empty(value);
        Assert.Equal(12, value.GridColumns);
        Assert.Equal(new EmptyBlocksSpot(Block, true, "items", IsGrid: true), registry.EmptyBlocksFor(value));
    }

    [Fact]
    public void OtherValues_PassThroughUnremembered()
    {
        (MarkedProperty property, MarkerRegistry registry) = Marked(42);

        Assert.Equal(42, property.GetValue());
        Assert.Null(registry.EmptyBlocksFor(42));
        Assert.Null(registry.EmptyBlocksFor(null));
    }
}
