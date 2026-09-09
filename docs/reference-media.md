# Reference property media

The first-release interface includes four locally stored editorial images so discovery, saved properties, comparison, and opportunity detail can be designed and tested as photo-first experiences before source media ingestion is enabled.

These images are not evidence about a real listing. Every rendered use must display `Imagen de referencia` or `Imagen editorial de referencia`. Verified source media should replace them through source adapters while retaining source attribution.

## Assets

- `apps/web/public/properties/palermo-living.jpg`: bright renovated apartment living room with a leafy balcony in Palermo.
- `apps/web/public/properties/palermo-facade.jpg`: mid-century residential facade on a tree-lined Palermo street.
- `apps/web/public/properties/mendoza-patio.jpg`: contemporary Chacras de Coria home opening to a shaded patio and foothill landscape.
- `apps/web/public/properties/mar-del-plata-bedroom.jpg`: calm ocean-view bedroom in Mar del Plata.

All four assets were generated with the built-in image generation workflow in the `photorealistic-natural` category, without text, logos, watermarks, identifiable people, signs, or impossible architecture. The originals were converted to 1280 px JPEG files at 80 percent quality for project use.

## Prompt policy

Each prompt specified:

- use in a modern Argentine real-estate application;
- horizontal 3:2 editorial composition suitable for responsive cropping;
- natural light and believable local materials;
- a calm, trustworthy mood;
- no text, logos, watermarks, focal people, real-estate signage, fisheye distortion, or UI chrome.

The scene-specific prompt then defined Palermo interior, Palermo facade, Chacras de Coria interior-patio, or Mar del Plata bedroom context respectively.
