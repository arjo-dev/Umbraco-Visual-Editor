using Arjo.VisualEditor.Markers;

namespace Arjo.VisualEditor.Tests.Markers;

public class MarkerRegistryTests
{
    private static readonly Guid Page = Guid.NewGuid();
    private static readonly Guid Block = Guid.NewGuid();

    [Fact]
    public void Register_AssignsSequentialIdsFromOne()
    {
        var registry = new MarkerRegistry();

        Assert.Equal(1, registry.Register(MarkerKind.Property, Page, false, "title", "en-US"));
        Assert.Equal(2, registry.Register(MarkerKind.Block, Block, true));
    }

    [Fact]
    public void Register_SameTargetGetsSameId()
    {
        // Values rendered more than once, and nested partials for one block, share an id.
        var registry = new MarkerRegistry();

        var first = registry.Register(MarkerKind.Property, Page, false, "title", "en-US");
        var again = registry.Register(MarkerKind.Property, Page, false, "title", "en-US");
        var blockA = registry.Register(MarkerKind.Block, Block, true);
        var blockB = registry.Register(MarkerKind.Block, Block, true);

        Assert.Equal(first, again);
        Assert.Equal(blockA, blockB);
        Assert.Equal(2, registry.All.Count);
    }

    [Fact]
    public void Register_DistinguishesCultureOwnerAndKind()
    {
        var registry = new MarkerRegistry();

        var ids = new[]
        {
            registry.Register(MarkerKind.Property, Page, false, "title", "en-US"),
            registry.Register(MarkerKind.Property, Page, false, "title", "da-DK"),
            registry.Register(MarkerKind.Property, Block, true, "title", "en-US"),
            registry.Register(MarkerKind.Block, Page, false, "title", "en-US"),
        };

        Assert.Equal(ids.Length, ids.Distinct().Count());
    }

    [Fact]
    public void All_IsOrderedById_WithDetails()
    {
        var registry = new MarkerRegistry();
        registry.Register(MarkerKind.Block, Block, true);
        registry.Register(MarkerKind.Property, Block, true, "caption", null, "Umbraco.TextBox");

        Assert.Collection(
            registry.All,
            m => Assert.Equal((1, MarkerKind.Block, Block, true), (m.Id, m.Kind, m.OwnerKey, m.OwnerIsBlock)),
            m => Assert.Equal((2, "caption", "Umbraco.TextBox"), (m.Id, m.Alias, m.EditorAlias)));
    }
}
