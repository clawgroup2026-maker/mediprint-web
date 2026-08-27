export async function onRequestGet(context) {
    try {
        // El token se guardará de forma segura en Cloudflare.
        // NO pongas el token directamente en este archivo.
        const token = context.env.INSTAGRAM_ACCESS_TOKEN;

        if (!token) {
            return new Response(
                JSON.stringify({
                    error: "Instagram token no configurado"
                }),
                {
                    status: 500,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        // Solicita las últimas 6 publicaciones de MediPrint
        const url =
            "https://graph.instagram.com/me/media" +
            "?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp" +
            "&limit=6" +
            `&access_token=${encodeURIComponent(token)}`;

        const response = await fetch(url);

        const data = await response.json();

        // Si Instagram devuelve un error
        if (!response.ok) {
            console.error("Instagram API error:", data);

            return new Response(
                JSON.stringify({
                    error: "No se pudo obtener el feed de Instagram"
                }),
                {
                    status: response.status,
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );
        }

        // Devuelve las publicaciones al index.html
        return new Response(
            JSON.stringify({
                data: data.data || []
            }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",

                    // Guarda temporalmente la respuesta
                    // para no consultar Instagram a cada segundo
                    "Cache-Control": "public, max-age=300"
                }
            }
        );

    } catch (error) {

        console.error("Instagram feed error:", error);

        return new Response(
            JSON.stringify({
                error: "Error interno cargando Instagram"
            }),
            {
                status: 500,
                headers: {
                    "Content-Type": "application/json"
                }
            }
        );
    }
}