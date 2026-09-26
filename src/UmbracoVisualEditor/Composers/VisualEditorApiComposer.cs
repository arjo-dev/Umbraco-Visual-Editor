#if !UMBRACO_17
using Umbraco.Cms.Api.Common.OpenApi;
using Umbraco.Cms.Api.Management.OpenApi;
#endif
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;

namespace UmbracoVisualEditor.Composers;

public class VisualEditorApiComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
#if UMBRACO_17
    {
        // Umbraco 17 documents its APIs with Swashbuckle; this OpenAPI document (only used to generate the client) is
        // registered on 18. The endpoints themselves work on both.
    }
#else
        =>

        // See https://docs.umbraco.com/umbraco-cms/tutorials/creating-a-backoffice-api (and its sub-pages) for
        // guidance on customizing this document.
        builder.AddBackOfficeOpenApiDocument(
            Constants.ApiName,
            document => document
                .WithTitle("Umbraco Visual Editor Backoffice API")
                .WithBackOfficeAuthentication()
                .WithJsonOptions(Umbraco.Cms.Core.Constants.JsonOptionsNames.BackOffice)
                .ConfigureOpenApiOptions(options =>
                    options.AddDocumentTransformer((doc, _, _) =>
                    {
                        doc.Info.Version = "1.0";
                        // doc.Info.Contact = new OpenApiContact
                        // {
                        //     Name = "Some Developer",
                        //     Email = "you@company.com",
                        //     Url = new Uri("https://company.com")
                        // };
                        return Task.CompletedTask;
                    })));
#endif
}
