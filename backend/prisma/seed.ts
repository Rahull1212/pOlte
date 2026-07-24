import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function hash(password: string) {
  return bcrypt.hash(password, 10);
}

async function main() {
  console.log("Seeding PoliOS demo hierarchy (3-role model: SUPER_ADMIN / ADMIN / CADRE)...");

  const state = await prisma.region.create({ data: { name: "Telangana", type: "STATE" } });

  const districts = await Promise.all(
    ["Hyderabad", "Warangal"].map((name) =>
      prisma.region.create({ data: { name, type: "DISTRICT", parentId: state.id } }),
    ),
  );

  const mandalsByDistrict: Record<string, { id: string; name: string }[]> = {};
  for (const district of districts) {
    const mandals = await Promise.all(
      [`${district.name} Mandal 1`, `${district.name} Mandal 2`].map((name) =>
        prisma.region.create({ data: { name, type: "MANDAL", parentId: district.id } }),
      ),
    );
    mandalsByDistrict[district.id] = mandals;
  }

  const boothsByMandal: Record<string, { id: string; name: string }[]> = {};
  for (const mandals of Object.values(mandalsByDistrict)) {
    for (const mandal of mandals) {
      const booths = await Promise.all(
        [`${mandal.name} Booth 1`, `${mandal.name} Booth 2`].map((name) =>
          prisma.region.create({ data: { name, type: "BOOTH", parentId: mandal.id } }),
        ),
      );
      boothsByMandal[mandal.id] = booths;
    }
  }

  const defaultPassword = await hash("Password@123");

  const superAdmin = await prisma.user.create({
    data: {
      name: "Super Admin",
      phone: "9000000001",
      email: "superadmin@polios.dev",
      passwordHash: defaultPassword,
      role: "SUPER_ADMIN",
      regionId: state.id,
    },
  });

  let phoneCounter = 9000000002;
  const nextPhone = () => String(phoneCounter++);

  let citizenCounter = 1;

  for (const district of districts) {
    const districtAdmin = await prisma.user.create({
      data: {
        name: `${district.name} District Admin`,
        phone: nextPhone(),
        passwordHash: defaultPassword,
        role: "ADMIN",
        regionId: district.id,
        parentUserId: superAdmin.id,
      },
    });

    const districtEvent = await prisma.event.create({
      data: {
        name: `${district.name} District Meeting`,
        description: "Quarterly review meeting with area Admins",
        regionId: district.id,
        startAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdById: districtAdmin.id,
      },
    });

    for (const mandal of mandalsByDistrict[district.id]) {
      const mandalAdmin = await prisma.user.create({
        data: {
          name: `${mandal.name} Admin`,
          phone: nextPhone(),
          passwordHash: defaultPassword,
          role: "ADMIN",
          regionId: mandal.id,
          parentUserId: districtAdmin.id,
        },
      });

      await prisma.eventParticipant.create({
        data: { eventId: districtEvent.id, userId: mandalAdmin.id },
      });

      for (const booth of boothsByMandal[mandal.id]) {
        const boothAdmin = await prisma.user.create({
          data: {
            name: `${booth.name} Admin`,
            phone: nextPhone(),
            passwordHash: defaultPassword,
            role: "ADMIN",
            regionId: booth.id,
            parentUserId: mandalAdmin.id,
          },
        });

        const cadre = await prisma.user.create({
          data: {
            name: `${booth.name} Cadre`,
            phone: nextPhone(),
            passwordHash: defaultPassword,
            role: "CADRE",
            regionId: booth.id,
            parentUserId: boothAdmin.id,
          },
        });

        // Sample citizen + grievance data registered by this booth's Cadre.
        const citizen = await prisma.citizen.create({
          data: {
            name: `Citizen ${citizenCounter++}`,
            phone: `90100000${String(citizenCounter).padStart(2, "0")}`,
            address: `${booth.name} area`,
            regionId: booth.id,
            registeredById: cadre.id,
          },
        });

        await prisma.grievance.create({
          data: {
            citizenId: citizen.id,
            regionId: booth.id,
            submittedById: cadre.id,
            category: "Water Supply",
            description: "No water supply for the last 3 days",
          },
        });
      }
    }
  }

  console.log("Done. Every seeded user's password is: Password@123");
  console.log(`Super Admin phone: ${superAdmin.phone}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
