"""Cubre la caché de contexto de Vertex AI para el prompt de sistema del
intérprete (~48.000 caracteres, idéntico en cada llamada). Usa un cliente
Gemini simulado: no llama a Vertex AI real ni necesita credenciales."""

import unittest
from unittest.mock import MagicMock, patch

import app


class FakeCachedContent:
    def __init__(self, name):
        self.name = name


class FakeCaches:
    def __init__(self):
        self.create_calls = 0

    def create(self, *, model, config):
        self.create_calls += 1
        return FakeCachedContent(f"cachedContents/fake-{self.create_calls}")


class FakeModels:
    def __init__(self, responses):
        self.generate_content_calls = []
        self._responses = list(responses)

    def generate_content(self, *, model, contents, config):
        self.generate_content_calls.append(config)
        outcome = self._responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        response = MagicMock()
        response.parsed = outcome
        return response


class VertexCacheTests(unittest.TestCase):
    def setUp(self):
        os_environ_patch = patch.dict("os.environ", {"GOOGLE_CLOUD_PROJECT": "angeli-secretaria"})
        os_environ_patch.start()
        self.addCleanup(os_environ_patch.stop)
        app._interpreter_cache_name = None
        app._interpreter_cache_expires_at = 0.0

    def _install_fake_client(self, models):
        caches = FakeCaches()
        client = MagicMock()
        client.caches = caches
        client.models = models
        genai_patch = patch("google.genai.Client", return_value=client)
        genai_patch.start()
        self.addCleanup(genai_patch.stop)
        return caches, client

    def test_second_call_reuses_the_same_cache_instead_of_recreating_it(self):
        models = FakeModels([{"intent": "note", "confidence": 0.9}, {"intent": "note", "confidence": 0.9}])
        caches, _client = self._install_fake_client(models)

        app.vertex_interpret("Apunta que compre leche", "2026-09-17T10:00:00", "Europe/Madrid")
        app.vertex_interpret("Apunta que compre pan", "2026-09-17T10:01:00", "Europe/Madrid")

        self.assertEqual(caches.create_calls, 1, "la segunda llamada debe reutilizar la caché, no crear otra")
        first_config, second_config = models.generate_content_calls
        self.assertIsNotNone(first_config.cached_content)
        self.assertIsNone(first_config.system_instruction, "con caché activa no debe reenviarse el prompt de sistema")
        self.assertEqual(first_config.cached_content, second_config.cached_content)

    def test_cache_creation_failure_falls_back_to_inline_system_instruction(self):
        models = FakeModels([{"intent": "note", "confidence": 0.9}])
        caches, _client = self._install_fake_client(models)
        caches.create = MagicMock(side_effect=RuntimeError("Vertex AI no disponible"))

        result = app.vertex_interpret("Apunta que compre leche", "2026-09-17T10:00:00", "Europe/Madrid")

        self.assertEqual(result, {"intent": "note", "confidence": 0.9})
        config = models.generate_content_calls[0]
        self.assertIsNone(config.cached_content)
        self.assertEqual(config.system_instruction, app.SYSTEM_INSTRUCTION)

    def test_expired_or_deleted_cache_retries_once_inline_instead_of_failing(self):
        models = FakeModels([RuntimeError("404 cachedContents no encontrado"), {"intent": "note", "confidence": 0.9}])
        self._install_fake_client(models)

        result = app.vertex_interpret("Apunta que compre leche", "2026-09-17T10:00:00", "Europe/Madrid")

        self.assertEqual(result, {"intent": "note", "confidence": 0.9})
        self.assertEqual(len(models.generate_content_calls), 2, "debe reintentar una vez sin caché, no propagar el error")
        failed_attempt, retry_attempt = models.generate_content_calls
        self.assertIsNotNone(failed_attempt.cached_content)
        self.assertIsNone(retry_attempt.cached_content)
        self.assertEqual(retry_attempt.system_instruction, app.SYSTEM_INSTRUCTION)
        self.assertIsNone(app._interpreter_cache_name, "una caché que falló al usarse debe invalidarse")


if __name__ == "__main__":
    unittest.main()
