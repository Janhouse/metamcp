import {
  CreateApiKeyRequestSchema,
  CreateApiKeyResponseSchema,
  DeleteApiKeyRequestSchema,
  DeleteApiKeyResponseSchema,
  ListApiKeysResponseSchema,
  UpdateApiKeyRequestSchema,
  UpdateApiKeyResponseSchema,
  ValidateApiKeyRequestSchema,
  ValidateApiKeyResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import logger from "@/utils/logger";

import { ApiKeysRepository, usersRepository } from "../db/repositories";
import { ApiKeysSerializer } from "../db/serializers";
import { resolveOwnerUserId } from "../lib/authz";

const apiKeysRepository = new ApiKeysRepository();

export const apiKeysImplementations = {
  create: async (
    input: z.infer<typeof CreateApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof CreateApiKeyResponseSchema>> => {
    try {
      // Owner is the authenticated caller. Only admins may create a key for
      // another user or a public (user_id = null) key; non-admins always get a
      // key scoped to themselves regardless of the supplied user_id.
      const apiKeyUserId = await resolveOwnerUserId(input.user_id, userId);

      const result = await apiKeysRepository.create({
        name: input.name,
        user_id: apiKeyUserId,
        is_active: true,
      });

      return ApiKeysSerializer.serializeCreateApiKeyResponse(result);
    } catch (error) {
      logger.error("Error creating API key:", error);
      throw new Error(
        error instanceof Error ? error.message : "Internal server error",
      );
    }
  },

  list: async (
    userId: string,
  ): Promise<z.infer<typeof ListApiKeysResponseSchema>> => {
    try {
      const apiKeys = await apiKeysRepository.findAccessibleToUser(userId);
      const isAdmin = await usersRepository.isAdmin(userId);

      return {
        // Mask the secret of any key the requester does not own (public/shared
        // keys are admin-managed); owners and admins see full values.
        apiKeys: ApiKeysSerializer.serializeApiKeyList(apiKeys, {
          requesterId: userId,
          isAdmin,
        }),
      };
    } catch (error) {
      logger.error("Error fetching API keys:", error);
      throw new Error("Failed to fetch API keys");
    }
  },

  update: async (
    input: z.infer<typeof UpdateApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof UpdateApiKeyResponseSchema>> => {
    try {
      const isAdmin = await usersRepository.isAdmin(userId);
      const result = await apiKeysRepository.update(
        input.uuid,
        userId,
        {
          name: input.name,
          is_active: input.is_active,
        },
        isAdmin,
      );

      return ApiKeysSerializer.serializeApiKey(result);
    } catch (error) {
      logger.error("Error updating API key:", error);
      throw new Error(
        error instanceof Error ? error.message : "Internal server error",
      );
    }
  },

  delete: async (
    input: z.infer<typeof DeleteApiKeyRequestSchema>,
    userId: string,
  ): Promise<z.infer<typeof DeleteApiKeyResponseSchema>> => {
    try {
      const isAdmin = await usersRepository.isAdmin(userId);
      await apiKeysRepository.delete(input.uuid, userId, isAdmin);

      return {
        success: true,
        message: "API key deleted successfully",
      };
    } catch (error) {
      logger.error("Error deleting API key:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  },

  validate: async (
    input: z.infer<typeof ValidateApiKeyRequestSchema>,
  ): Promise<z.infer<typeof ValidateApiKeyResponseSchema>> => {
    try {
      const result = await apiKeysRepository.validateApiKey(input.key);
      return {
        valid: result.valid,
        user_id: result.user_id ?? undefined,
        key_uuid: result.key_uuid,
      };
    } catch (error) {
      logger.error("Error validating API key:", error);
      return { valid: false };
    }
  },
};
