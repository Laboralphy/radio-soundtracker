import { z } from 'zod';

export const SongEntryDefinitionSchema = z.object({
    type: z.literal('song'),
    location: z.string(),
});

export const FolderEntryDefinitionSchema = z.object({
    type: z.literal('folder'),
    location: z.string(),
    shuffle: z.boolean().optional().default(false),
    limit: z.number().optional().default(Infinity),
    recursive: z.boolean().optional().default(false),
});

/**
 * References another program already registered in a ProgramLibrary by name.
 */
export const ProgramRefEntryDefinitionSchema = z.object({
    type: z.literal('program'),
    name: z.string(),
});

export const ProgramEntryDefinitionSchema = z.discriminatedUnion('type', [
    SongEntryDefinitionSchema,
    FolderEntryDefinitionSchema,
    ProgramRefEntryDefinitionSchema,
]);

export const ProgramDefinitionSchema = z.object({
    entries: z.array(ProgramEntryDefinitionSchema),
});

export type SongEntryDefinition = z.infer<typeof SongEntryDefinitionSchema>;
export type FolderEntryDefinition = z.infer<typeof FolderEntryDefinitionSchema>;
export type ProgramRefEntryDefinition = z.infer<typeof ProgramRefEntryDefinitionSchema>;
export type ProgramEntryDefinition = z.infer<typeof ProgramEntryDefinitionSchema>;
export type ProgramDefinition = z.infer<typeof ProgramDefinitionSchema>;
