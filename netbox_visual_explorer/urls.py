from django.urls import path

from .views import device_details, explorer

urlpatterns = [
    path("", explorer, name="explorer"),
    path("devices/<int:pk>/details/", device_details, name="device_details"),
]
