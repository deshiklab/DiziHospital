<?php

declare(strict_types=1);

use App\Support\ModuleSchema;
use Illuminate\Database\Migrations\Migration;

/**
 * The identity module's schema, which this slice creates empty.
 *
 * It is created — rather than left for later — because the schema is the module's boundary and the boundary is the
 * thing that has to exist first: a later migration that adds `identity.staff_members` when staff arrive from Keycloak
 * (ticket #24) must not also be the migration that decides where they live. Until then there is nothing to store:
 * the token verifier is stateless, and the roles it enforces are the ones the issuer puts in the token.
 */
return new class extends Migration
{
    public function up(): void
    {
        ModuleSchema::create('identity');
    }

    public function down(): void
    {
        ModuleSchema::drop('identity');
    }
};
