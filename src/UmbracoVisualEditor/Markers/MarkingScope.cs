namespace UmbracoVisualEditor.Markers;

/// <summary>
/// Set while *our* properties convert values (the edited document's overlay properties and marked block properties),
/// so the model factory decorator only marks block elements created for the canvas. Elements Umbraco creates for its
/// shared published cache during the same request (e.g. the live version of the page, loaded by navigation) must
/// never be marked: the cache would keep the marked instance and serve it to live visitors.
/// </summary>
internal static class MarkingScope
{
    private static readonly AsyncLocal<int> Depth = new();

    public static bool IsActive => Depth.Value > 0;

    public static T Run<T>(Func<T> action)
    {
        Depth.Value++;
        try
        {
            return action();
        }
        finally
        {
            Depth.Value--;
        }
    }
}
