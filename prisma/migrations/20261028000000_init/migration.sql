-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(36) NOT NULL,
    `nickname` VARCHAR(24) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` VARCHAR(36) NOT NULL,
    `code` VARCHAR(8) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rooms_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `case_templates` (
    `id` VARCHAR(40) NOT NULL,
    `version` INTEGER NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `data` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matches` (
    `id` VARCHAR(36) NOT NULL,
    `roomId` VARCHAR(36) NOT NULL,
    `caseId` VARCHAR(40) NOT NULL,
    `caseVersion` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `result` JSON NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_players` (
    `id` VARCHAR(36) NOT NULL,
    `matchId` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `side` VARCHAR(20) NOT NULL,
    `identity` VARCHAR(20) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `publicConfig` JSON NOT NULL,

    UNIQUE INDEX `match_players_matchId_side_key`(`matchId`, `side`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_events` (
    `id` VARCHAR(36) NOT NULL,
    `matchId` VARCHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `data` JSON NOT NULL,

    UNIQUE INDEX `match_events_matchId_sequence_key`(`matchId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `llm_calls` (
    `id` VARCHAR(36) NOT NULL,
    `matchId` VARCHAR(36) NOT NULL,
    `side` VARCHAR(20) NOT NULL,
    `provider` VARCHAR(30) NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `status` VARCHAR(40) NOT NULL,
    `inputTokens` INTEGER NOT NULL,
    `outputTokens` INTEGER NOT NULL,
    `durationMs` INTEGER NOT NULL,
    `estimatedCost` DECIMAL(14, 8) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `case_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_players` ADD CONSTRAINT `match_players_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_players` ADD CONSTRAINT `match_players_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_events` ADD CONSTRAINT `match_events_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `llm_calls` ADD CONSTRAINT `llm_calls_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
