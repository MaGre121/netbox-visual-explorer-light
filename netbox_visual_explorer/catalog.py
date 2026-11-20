from functools import wraps

from core import views

from . import config


def register_plugin_details():
    # NetBox 4.5 populates the URL and license only for online catalog entries.
    # Supply missing values on our detail page, before the native template renders.
    plugin_view = getattr(views, "PluginView", None)
    get_cached_plugins = getattr(plugin_view, "get_cached_plugins", None)
    if not get_cached_plugins or getattr(get_cached_plugins, "_visual_explorer_metadata", False):
        return

    @wraps(get_cached_plugins)
    def with_local_metadata(view, request):
        plugins = get_cached_plugins(view, request)
        if view.kwargs.get("name") == config.name and (plugin := plugins.get(config.name)):
            plugin.homepage_url = plugin.homepage_url or config.homepage_url
            plugin.license_type = plugin.license_type or config.license_type
        return plugins

    with_local_metadata._visual_explorer_metadata = True
    plugin_view.get_cached_plugins = with_local_metadata
