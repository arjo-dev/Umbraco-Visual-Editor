namespace UmbracoVisualEditor
{
    public class Constants
    {
        public const string ApiName = "arjovisualeditor";

        /// <summary>
        /// The class the Visual editor adds to a page's <c>&lt;html&gt;</c> element, so a site's CSS can style its pages
        /// there only: <c>.uve-editing .reveal { opacity: 1; }</c>. Never added on the live site or in preview.
        /// </summary>
        public const string HtmlClass = "uve-editing";
    }
}
