'use client'
import { socket } from './components/socket.js'
import { useEffect, useState, useRef } from 'react'



const Dashboard = () => {
type JobCounts = {
  pending: number
  active: number
  completed: number
  failed: number
}
 const [Info, setInfo] = useState<any>([]);
  const [InfoIndex, setInfoIndex] = useState<any>(0);
  const [jobs, setJobs] = useState<{[key:string]:string}>({})
const [jobCounts, setJobCounts] = useState<JobCounts>({
  pending: 0,
  active: 0,
  completed: 0,
  failed: 0
})
const TimerRef = useRef<any>(null)
        
  const moveJob = (jobId:string,status:string, job : JobCounts)=>{
    console.log(job)
    if(status === 'stats'){
      setJobCounts({
           ...job
      })
    }else{
    setJobs(prev => ({
      ...prev,
      [jobId]: status
    }))
  }
  }

const Servers_activator = async () => {
  setInfo([
    "Wait a second, we're setting things up...",
    "Connecting to the job queue...",
    "Preparing your job...",
    "Checking worker availability...",
    "Almost there..."
  ]);

  const servers = [
    "https://socket-server-2n9d.onrender.com/health",
    "https://ouboxworker.onrender.com/health",
    "https://worker-xnpk.onrender.com/health"
  ];

  try {
    const responses = await Promise.all(
      servers.map(link => fetch(link))
    );

    if (responses.some(response => !response.ok)) {
      throw new Error("One or more servers are not healthy");
    }
  } catch (error) {
    console.error("Server activation failed:", error);
    throw error;
  }

  clearInterval(TimerRef.current);
  setInfo([]);
  setInfoIndex(0);
};

  useEffect(()=>{

  socket.onAny((event : any,data : any)=>{
    console.log("SOCKET EVENT:",event,data)
  })

},[])

    useEffect(() => {

    if (!socket.connected) {
      socket.connect()
    }

    const handleConnect = () => {
      console.log("connected", socket.id)
      socket.emit("join",{group:"user123"})
    }

    const handleJobUpdate = (data :any )=>{
      moveJob(data.jobId,data.type, data)
    }

    socket.on("connect",handleConnect)
    socket.on("job_update",handleJobUpdate)

    return ()=>{
      socket.off("connect",handleConnect)
      socket.off("job_update",handleJobUpdate)
    }

  },[])

 useEffect(() => {
  if (Info.length === 0) return;

  TimerRef.current = setInterval(() => {
    setInfoIndex((prev : any) => (prev + 1) % Info.length);
  }, 900);

  return () => {
    clearInterval(TimerRef.current);
  };
}, [Info]);

  useEffect(() => {
       console.log(InfoIndex)
  },[InfoIndex])

  const pending = Object.keys(jobs).filter(j => jobs[j] === "pending")
  const active = Object.keys(jobs).filter(j => jobs[j] === "active")
  const completed = Object.keys(jobs).filter(j => jobs[j] === "completed")
  const failed = Object.keys(jobs).filter(j => jobs[j] === "failed")

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <header className="mb-10">
        <h1 className="text-3xl font-bold text-gray-800">
          Worker Management Dashboard
        </h1>
        <p className="text-gray-500 mt-2">
          Live job processing monitor
        </p>
      </header>
    {/* Create Job */}
<section className="bg-white rounded-xl shadow p-6 mb-10">
  <h2 className="text-xl font-semibold text-gray-800 mb-1">
    Create Job
  </h2>

  <p className="text-sm text-gray-500 mb-6">
    Add a new job to the processing queue
  </p>

  <form
    onSubmit={async (e) => {
      e.preventDefault();

      const form = e.currentTarget;
      const formData = new FormData(form);

      const payload = {
        type: formData.get("type"),
        
      };


      try {
        await Servers_activator();
        const response = await fetch("https://job-queue-2.onrender.com/api/createjob", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            'idompotency-key': String(formData.get("idempotencyKey") || ""),
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to create job");
        }

        console.log("Job created:", data);

        form.reset();
      } catch (error) {
        console.error("Error creating job:", error);
      }
    }}
    className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end"
  >
    {/* Job Type */}
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Job Type
      </label>

      <select
        name="type"
        defaultValue="email_generation"
        className="w-full border text-black border-gray-300 rounded-lg px-3 py-2.5
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="email_generation">
          Email Generation
        </option>

        {/* Add more job types later */}
        {/* <option value="image_generation">Image Generation</option> */}
        {/* <option value="report_generation">Report Generation</option> */}
      </select>
    </div>

    {/* Idempotency Key */}
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Idempotency Key
      </label>

      <input
        name="idempotencyKey"
        type="text"
        placeholder="e.g. order-123-email"
        className="w-full border text-black border-gray-300 rounded-lg px-3 py-2.5
                   focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <p className="text-xs text-gray-400 mt-1">
        Optional. Prevents duplicate jobs.
      </p>
    </div>

    {/* Submit */}
    <div className={`${Info.length > 0 ? 'block' : 'hidden'} font-medium rounded-lg px-5 py-2.5 text-black `}>{Info[InfoIndex]}</div>
  <button
      type="submit"
      className={ `${Info.length === 0 ? 'block': 'hidden'} bg-blue-600 hover:bg-blue-700 text-white
                 font-medium rounded-lg px-5 py-2.5 transition`}
    >
      + Create Job
    </button>
  </form>
</section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Pending</h2>
          <p className="text-2xl font-bold">{jobCounts?.pending}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Active</h2>
          <p className="text-2xl font-bold">{jobCounts?.active}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Completed</h2>
          <p className="text-2xl font-bold">{jobCounts?.completed}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Failed</h2>
          <p className="text-2xl font-bold">{jobCounts?.failed}</p>
        </div>

      </section>
        


      {/* Job Columns */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Pending */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-yellow-600">Pending</h3>
          {pending.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Active */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-green-600">Active</h3>
          {active.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Completed */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-blue-600">Completed</h3>
          {completed.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Failed */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-red-600">Failed</h3>
          {failed.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

      </section>

    </main>
  )
}

export default Dashboard