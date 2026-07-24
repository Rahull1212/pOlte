import { Task } from "@/hooks/use-tasks";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

const columns: { status: Task["status"]; label: string }[] = [
  { status: "PENDING", label: "Pending" },
  { status: "IN_PROGRESS", label: "In Progress" },
  { status: "COMPLETED", label: "Completed" },
  { status: "OVERDUE", label: "Overdue" },
];

const priorityTone: Record<Task["priority"], "slate" | "blue" | "amber"> = {
  LOW: "slate",
  MEDIUM: "blue",
  HIGH: "amber",
};

export function TaskBoard({ tasks }: { tasks: Task[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {columns.map((column) => {
        const columnTasks = tasks.filter((t) => t.status === column.status);
        return (
          <div key={column.status}>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{column.label}</h4>
              <span className="text-xs text-slate-400">{columnTasks.length}</span>
            </div>
            <div className="space-y-2">
              {columnTasks.map((task) => (
                <Card key={task.id} className="p-3">
                  <p className="text-sm font-medium text-slate-800">{task.name}</p>
                  <p className="mt-1 text-xs text-slate-500">Assignee: {task.assignedTo?.name}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <Badge tone={priorityTone[task.priority]}>{task.priority}</Badge>
                    <span className="text-xs text-slate-500">
                      Due {new Date(task.deadline).toLocaleDateString()}
                    </span>
                  </div>
                </Card>
              ))}
              {columnTasks.length === 0 && (
                <p className="rounded-md border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
                  Nothing here
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
