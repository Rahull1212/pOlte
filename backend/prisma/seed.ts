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

  // A handful of real Assembly Constituencies with their official ECI
  // numbers — enough to demo. prisma/import-eci-regions.ts loads all 119.
  const AC_BY_DISTRICT: Record<string, { name: string; no: string }[]> = {
    Hyderabad: [
      { name: "Khairatabad", no: "60" },
      { name: "Jubilee Hills", no: "61" },
    ],
    Warangal: [
      { name: "Narsampet", no: "103" },
      { name: "Parkal", no: "104" },
    ],
  };

  const constituenciesByDistrict: Record<string, { id: string; name: string }[]> = {};
  for (const district of districts) {
    const constituencies = await Promise.all(
      AC_BY_DISTRICT[district.name].map((ac) =>
        prisma.region.create({
          data: { name: ac.name, number: ac.no, type: "CONSTITUENCY", parentId: district.id },
        }),
      ),
    );
    constituenciesByDistrict[district.id] = constituencies;
  }

  const boothsByConstituency: Record<string, { id: string; name: string }[]> = {};
  for (const constituencies of Object.values(constituenciesByDistrict)) {
    for (const constituency of constituencies) {
      const booths = await Promise.all(
        [1, 2].map((n) =>
          prisma.region.create({
            data: {
              name: `Government Primary School, ${constituency.name} — Room ${n}`,
              number: String(n),
              type: "BOOTH",
              parentId: constituency.id,
            },
          }),
        ),
      );
      boothsByConstituency[constituency.id] = booths;
    }
  }

  const defaultPassword = await hash("Password@123");

  const superAdmin = await prisma.user.create({
    data: {
      name: "Arjun Reddy",
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

  const adminNames = [
    "Ravi Kumar", "Srinivas Reddy", "Lakshmi Devi", "Anitha Rao",
    "Suresh Babu", "Padma Naidu", "Venkatesh Goud", "Kavitha Reddy",
    "Ramesh Chandra", "Sunitha Rani", "Krishna Murthy", "Divya Sri",
    "Naveen Kumar", "Priya Sharma", "Mahesh Yadav", "Swathi Reddy",
    "Rajesh Varma", "Sowmya Rani", "Vijay Kumar", "Meena Kumari",
    "Sandeep Reddy", "Anjali Devi",
  ];
  let nameIndex = 0;
  const nextName = () => adminNames[nameIndex++ % adminNames.length];

  for (const district of districts) {
    const districtAdmin = await prisma.user.create({
      data: {
        name: nextName(),
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

    for (const constituency of constituenciesByDistrict[district.id]) {
      const constituencyAdmin = await prisma.user.create({
        data: {
          name: nextName(),
          phone: nextPhone(),
          passwordHash: defaultPassword,
          role: "ADMIN",
          regionId: constituency.id,
          parentUserId: districtAdmin.id,
        },
      });

      await prisma.eventParticipant.create({
        data: { eventId: districtEvent.id, userId: constituencyAdmin.id },
      });

      for (const booth of boothsByConstituency[constituency.id]) {
        const boothAdmin = await prisma.user.create({
          data: {
            name: nextName(),
            phone: nextPhone(),
            passwordHash: defaultPassword,
            role: "ADMIN",
            regionId: booth.id,
            parentUserId: constituencyAdmin.id,
          },
        });

        const cadre = await prisma.user.create({
          data: {
            name: nextName(),
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
