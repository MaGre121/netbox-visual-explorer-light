from netbox.plugins import PluginConfig


class VisualExplorerConfig(PluginConfig):
    name = "netbox_visual_explorer"
    verbose_name = "Visual Explorer"
    author = "Matthias Grebe"
    description = "Interaktive Netzpläne für Sites, Locations, Racks und Geräte."
    homepage_url = "https://github.com/MaGre121/netbox-visual-explorer-light"
    license_type = "Apache-2.0"
    version = "0.3.6b"
    base_url = "visual-explorer"
    min_version = "4.5.0"

    def ready(self):
        super().ready()
        from . import views  # Register the DCIM object tabs before URL resolution.
        from .catalog import register_plugin_details

        register_plugin_details()


config = VisualExplorerConfig
